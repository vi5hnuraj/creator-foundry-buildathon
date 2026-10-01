"""
Creator Foundry Critic — HTTP service.

POST /critic/score   (multipart: candidate file + optional reference files,
                      or JSON: {candidate_url, reference_urls})
→ { style_score, palette_match, quality, notes, model: "clip-critic-v1" }

Run:
  uvicorn serve:app --port 8787
The Next.js app calls this when CRITIC_SERVICE_URL is set; otherwise it falls
back to the built-in simulation.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

import requests
from typing import List, Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

import critic

app = FastAPI(title="Creator Foundry Critic", version="1.0")

_head = None
_clip = None
_default_refs: list[Image.Image] = []


def _lazy_init() -> None:
    global _head, _clip, _default_refs
    if _head is not None:
        return
    weights = Path(__file__).parent / "critic_head.pt"
    if not weights.exists():
        raise RuntimeError(
            "critic_head.pt not found — run `python train.py` first"
        )
    _head = critic.load_head(str(weights))
    _clip = critic.ClipBackend()
    _default_refs = [
        Image.open(p) for p in sorted(Path(__file__).parent.glob("ref_*.png"))
    ]


def _load(img_bytes: bytes) -> Image.Image:
    return Image.open(io.BytesIO(img_bytes))


def _fetch(url: str) -> Image.Image:
    if url.startswith("/"):  # app-relative (e.g. /api/files/xxx)
        base = os.environ.get("APP_ORIGIN", "http://localhost:3000")
        url = base + url
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return _load(r.content)


# ---------------------------------------------------------------------------
# Per-project style-guide plates — procedural references in the project's OWN
# brand palette, so the critic judges submissions against that project's
# visual identity instead of the generic training references.
# ---------------------------------------------------------------------------
_palette_cache: dict[str, list[Image.Image]] = {}


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return (128, 128, 128)


def _palette_plates(palette: str) -> list[Image.Image]:
    """4 procedural poster-style plates built from the project's hex colors."""
    key = palette.strip().lower()
    if key in _palette_cache:
        return _palette_cache[key]

    import math

    import numpy as np
    from PIL import ImageDraw, ImageFilter

    colors = [_hex_to_rgb(x) for x in palette.split(",") if x.strip()][:4]
    while len(colors) < 3:
        colors.append((40, 40, 48))
    dark = min(colors, key=lambda c: sum(c))
    mid = max(colors[:3], key=lambda c: sum(c))
    accents = [c for c in colors if c is not dark][:3] or [mid]

    plates: list[Image.Image] = []
    for seed in range(4):
        rng = np.random.default_rng(seed + 17)
        w = h = 512
        top = np.array(dark, dtype=np.float32)
        bottom = np.array(mid, dtype=np.float32)
        grad = np.linspace(0, 1, h).reshape(h, 1, 1)
        arr = (top * (1 - grad) + bottom * grad).astype(np.uint8)
        img = Image.fromarray(np.repeat(arr, w, axis=1))
        d = ImageDraw.Draw(img, "RGBA")
        for i in range(10):
            color = accents[i % len(accents)] + (rng.integers(70, 160),)
            cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
            r = int(rng.integers(30, 110))
            if i % 3 == 0:
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
            elif i % 3 == 1:
                d.rectangle([cx - r, cy - r // 2, cx + r, cy + r // 2], fill=color)
            else:
                d.polygon([(cx, cy - r), (cx + r, cy + r), (cx - r, cy + r)], fill=color)
        d.line([(0, int(h * 0.72)), (w, int(h * 0.72))], fill=accents[0] + (255,), width=5)
        sr = 70
        d.ellipse([w // 2 - sr, int(h * 0.72) - sr, w // 2 + sr, int(h * 0.72) + sr], fill=accents[1 % len(accents)] + (220,))
        img = img.filter(ImageFilter.GaussianBlur(0.6))
        noise = (rng.normal(0, 5, (h, w, 3))).astype(np.int16)
        arr = np.clip(np.asarray(img).astype(np.int16) + noise, 0, 255).astype(np.uint8)
        plates.append(Image.fromarray(arr))

    _palette_cache[key] = plates
    return plates


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": "clip-critic-v1"}


@app.post("/critic/score")
async def score_endpoint(
    candidate: Optional[UploadFile] = File(default=None),
    references: Optional[List[UploadFile]] = File(default=None),
    candidate_url: Optional[str] = Form(default=None),
    reference_urls: Optional[str] = Form(default=None),  # comma-separated
    palette: Optional[str] = Form(default=None),  # comma-separated hex colors → per-project style guide
):
    try:
        _lazy_init()

        if candidate is not None:
            cand = _load(await candidate.read())
        elif candidate_url:
            cand = _fetch(candidate_url)
        else:
            return JSONResponse({"error": "candidate file or candidate_url required"}, status_code=400)

        refs: list[Image.Image] = []
        if references:
            for f in references:
                refs.append(_load(await f.read()))
        elif reference_urls:
            for u in [u.strip() for u in reference_urls.split(",") if u.strip()]:
                refs.append(_fetch(u))
        if not refs:
            # Priority: explicit project palette (per-project style guide) →
            # generic training references as the last resort.
            refs = _palette_plates(palette) if palette else _default_refs

        v = critic.score(_clip, _head, refs, cand)
        return {
            "style_score": v.style_score,
            "palette_match": v.palette_match,
            "quality": v.quality,
            "notes": v.notes,
            "model": "clip-critic-v1",
        }
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    # Preload model + references BEFORE the server accepts requests — the app's
    # critic call has a timeout, and a cold CLIP load (~40s) would blow through
    # it and silently downgrade to the simulation fallback.
    print("[serve] preloading critic model…")
    _lazy_init()
    print("[serve] critic model ready (clip-critic-v1)")

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("CRITIC_PORT", "8787")))
