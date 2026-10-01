"""
Train the Creator Foundry critic head.

Creates a few synthetic "reference" images (procedural poster-style art), then
trains the scoring head on controlled distortions of them. No external dataset
or downloads beyond the CLIP weights (~350MB, cached after first run).

Usage:
  python train.py            # trains + saves critic_head.pt
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import critic

PALETTES = [
    [(123, 108, 255), (255, 92, 143), (47, 217, 196), (18, 18, 26)],   # cyberpunk
    [(240, 200, 90), (200, 80, 40), (30, 30, 40), (245, 240, 230)],    # warm retro
    [(60, 140, 230), (30, 200, 180), (10, 25, 50), (230, 245, 255)],   # oceanic
    [(180, 90, 220), (250, 120, 180), (25, 10, 40), (245, 235, 250)],  # neon violet
]


def make_reference(seed: int, size: int = 512) -> Image.Image:
    """Procedural poster-style reference art (shapes + gradients + grain)."""
    rng = np.random.default_rng(seed)
    pal = PALETTES[seed % len(PALETTES)]
    w = h = size

    # vertical gradient background
    top = np.array(pal[3]); bottom = np.array(pal[2])
    grad = np.linspace(0, 1, h).reshape(h, 1, 1)
    arr = (top * (1 - grad) + bottom * grad).astype(np.uint8)
    img = Image.fromarray(np.repeat(arr, w, axis=1))

    d = ImageDraw.Draw(img, "RGBA")
    # floating shapes
    for i in range(14):
        color = pal[i % 3] + (rng.integers(90, 200),)
        cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
        r = int(rng.integers(size // 16, size // 4))
        if i % 3 == 0:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
        elif i % 3 == 1:
            d.rectangle([cx - r, cy - r // 2, cx + r, cy + r // 2], fill=color)
        else:
            d.polygon([(cx, cy - r), (cx + r, cy + r), (cx - r, cy + r)], fill=color)
    # horizon line + sun (poster motif)
    d.line([(0, int(h * 0.72)), (w, int(h * 0.72))], fill=pal[0] + (255,), width=6)
    sun_r = size // 6
    d.ellipse([w // 2 - sun_r, int(h * 0.72) - sun_r, w // 2 + sun_r, int(h * 0.72) + sun_r], fill=pal[1] + (230,))
    # film grain
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    noise = (np.random.default_rng(seed).normal(0, 6, (h, w, 3))).astype(np.int16)
    arr = np.clip(np.asarray(img).astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def main() -> None:
    print("== Creator Foundry — Critic training ==")
    refs = [make_reference(s) for s in range(4)]
    for i, r in enumerate(refs):
        r.save(f"ref_{i}.png")  # keep for inspection / serving defaults
    model = critic.train(refs, epochs=60, out_path="critic_head.pt")

    # self-check 1: a clean reference scored against its own style guide
    head, clip = model, critic.ClipBackend()
    v = critic.score(clip, head, [refs[0]], refs[0])
    print("self-check (clean reference):", v)
    assert v.style_score > 60 and v.quality > 60, "self-check failed — training unstable"

    # self-check 2: a degraded copy must score strictly lower (discrimination)
    degraded = refs[0].filter(ImageFilter.GaussianBlur(3.0))
    v2 = critic.score(clip, head, [refs[0]], degraded)
    print("self-check (blurred copy):   ", v2)
    assert v2.quality < v.quality and v2.style_score < v.style_score, "model not discriminating"
    print("✅ self-check passed — model ready (critic_head.pt)")


if __name__ == "__main__":
    main()
