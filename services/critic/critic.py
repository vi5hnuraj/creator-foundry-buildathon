"""
Creator Foundry — CLIP-based Creative Critic (Python)

A small, genuinely-trained scoring model:

  image ──► CLIP ViT-B/32 (frozen) ──► 512-d embedding ──► trained MLP head
                                                        ├─► style_score    (0–100)
                                                        ├─► palette_match  (0–1)
                                                        └─► quality        (0–100)

Training strategy (no external dataset needed):
  We synthesize a labeled dataset from a handful of "reference" images by
  applying controlled distortions (color shifts = palette drift, blur/noise =
  quality drop, crops/flips = style perturbation). The label for each sample
  derives from the KNOWN distortion magnitude, so the model learns to regress
  real perceptual deltas from CLIP embedding space.

  • style_score:  1 - styleDistortionMagnitude
  • palette_match: 1 - colorShiftMagnitude
  • quality:       1 - (blur + noise + jpeg) degradation

At inference, a submitted asset is compared against the project's reference
images; the head converts embedding distances/distortions into scores.

Run:
  python train.py          # trains + saves critic_head.pt (~1-2 min on M-series)
  uvicorn serve:app --port 8787
"""

from __future__ import annotations

import io
import math
import random
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageEnhance, ImageFilter

DEVICE = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
CLIP_MODEL_NAME = "ViT-B-32"
CLIP_PRETRAINED = "laion2b_s34b_b79k"


# ---------------------------------------------------------------------------
# Scoring head — the part we actually train
# ---------------------------------------------------------------------------
class CriticHead(nn.Module):
    """Maps [cosine, 1-cos, delta stats, pixel-domain features] → (style, palette, quality).

    CLIP cosine alone saturates (~0.84 even at max distortion), so we add
    pixel-domain perceptual features that respond linearly to our distortions:
    per-channel mean/std deltas and gradient-energy deltas between reference
    and candidate. The head learns the mapping feature→score.
    """

    IN_DIM = 512 + 8 + 12  # clip-delta(512) + delta stats(8) + pixel features(12)

    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(self.IN_DIM, 256),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(256, 64),
            nn.ReLU(),
            nn.Linear(64, 3),
            nn.Sigmoid(),  # outputs in [0, 1]; scaled to 0–100 outside
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


@dataclass
class CriticVerdict:
    style_score: float      # 0–100
    palette_match: float    # 0–1
    quality: float          # 0–100
    notes: str


# ---------------------------------------------------------------------------
# CLIP wrapper (loaded lazily; weights cached in ~/.cache/clip after first run)
# ---------------------------------------------------------------------------
class ClipBackend:
    def __init__(self) -> None:
        import open_clip  # heavy import — deferred

        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            CLIP_MODEL_NAME, pretrained=CLIP_PRETRAINED
        )
        self.model.eval().to(DEVICE)

    @torch.no_grad()
    def embed(self, img: Image.Image) -> torch.Tensor:
        t = self.preprocess(img.convert("RGB")).unsqueeze(0).to(DEVICE)
        feats = self.model.encode_image(t)
        return feats / feats.norm(dim=-1, keepdim=True)


# ---------------------------------------------------------------------------
# Synthetic training data — controlled distortions with known labels
# ---------------------------------------------------------------------------
def _rand_color_shift(img: Image.Image, strength: float) -> Image.Image:
    """Palette drift with a magnitude that scales DETERMINISTICALLY with `strength`
    (random direction within a bounded arc, fixed length). This keeps the label
    ↔ feature relationship monotonic so the head can learn it."""
    arr = np.asarray(img).astype(np.float32)
    rng = np.random.default_rng(42 + int(strength * 1000))
    # direction: random unit vector, but magnitude strictly = strength * 60 levels
    direction = rng.normal(size=3)
    direction /= np.linalg.norm(direction) + 1e-8
    shift = direction * 60.0 * strength
    for c in range(3):
        arr[..., c] = np.clip(arr[..., c] + shift[c], 0, 255)
    return Image.fromarray(arr.astype(np.uint8))


def _degrade(img: Image.Image, blur: float, noise: float, jpeg: int) -> Image.Image:
    out = img
    if blur > 0:
        out = out.filter(ImageFilter.GaussianBlur(blur))
    if noise > 0:
        arr = np.asarray(out).astype(np.int16)
        rng = np.random.default_rng(7 + int(noise * 1000))
        arr = np.clip(arr + rng.normal(0, 30 * noise, arr.shape), 0, 255).astype(np.uint8)
        out = Image.fromarray(arr)
    if jpeg < 95:
        buf = io.BytesIO()
        out.save(buf, "JPEG", quality=jpeg)
        buf.seek(0)
        out = Image.open(buf)
    return out


def pixel_features(ref: Image.Image, cand: Image.Image) -> list[float]:
    """12 pixel-domain perceptual features that respond linearly to distortions."""
    size = (256, 256)
    a = np.asarray(ref.convert("RGB").resize(size)).astype(np.float32) / 255.0
    b = np.asarray(cand.convert("RGB").resize(size)).astype(np.float32) / 255.0
    diff = np.abs(a - b)
    per_ch_mean = diff.mean(axis=(0, 1))
    per_ch_std = diff.std(axis=(0, 1))
    def grad_energy(x):
        gy, gx = np.gradient(x.mean(axis=2))
        return float(np.sqrt(gx**2 + gy**2).mean())
    ge_ref, ge_cand = grad_energy(a), grad_energy(b)
    lum_a = a.mean(axis=2); lum_b = b.mean(axis=2)
    return [
        float(per_ch_mean[0]), float(per_ch_mean[1]), float(per_ch_mean[2]),
        float(per_ch_std[0]), float(per_ch_std[1]), float(per_ch_std[2]),
        abs(ge_ref - ge_cand),
        float(np.corrcoef(lum_a.ravel(), lum_b.ravel())[0, 1]),
        float(np.abs(lum_a.mean() - lum_b.mean())),
        float(np.abs(lum_a.std() - lum_b.std())),
        float(diff.max()),
        float((diff > 0.1).mean()),
    ]


def _featurize(clip: ClipBackend, ref: Image.Image, ref_emb: torch.Tensor, img: Image.Image) -> torch.Tensor:
    """Shared train/inference feature builder — guarantees distribution parity.

    512-d CLIP-embedding delta + 8 hand-crafted delta stats + 12 pixel-domain
    features. NO known-distortion magnitudes (inference doesn't know them; the
    model must learn purely from measurable deltas)."""
    cand_emb = clip.embed(img)
    delta = (ref_emb - cand_emb).abs().squeeze(0)          # [512]
    cos = float((ref_emb * cand_emb).sum())
    pix = pixel_features(ref, img)
    extra = torch.tensor([float(cos), 1.0 - float(cos), float(delta.mean()), float(delta.max()), float(delta.std()), float((delta > 0.05).float().mean()), float(delta.median()), 1.0] + pix, device=DEVICE)
    return torch.cat([delta, extra])  # [532]


def make_training_pairs(clip: ClipBackend, refs: list[Image.Image], n_per_ref: int = 240):
    """Yield (input_vector, target) pairs with labels from known distortion magnitudes.

    Three sample families:
      1. Identity (12%) — exact match pins the perfect-score point.
      2. Cross-reference (25%) — a DIFFERENT reference's clean image is a
         same-style/different-composition POSITIVE (style ~0.75-0.95):
         teaches the model that style consistency ≠ pixel identity.
      3. Distortions — controlled degradations of each reference with labels
         from known magnitudes (style/palette/quality regressions).
    """
    X, Y = [], []
    for ref in refs:
        ref_emb = clip.embed(ref)
        for _ in range(n_per_ref):
            # 12% identity samples: pin the "exact match → perfect score" point.
            # Pure-distortion sampling almost never visits it (0.05³ ≈ 1e-4),
            # so the model had to extrapolate there — the self-check cliff.
            roll = random.random()
            if roll < 0.12:
                X.append(_featurize(clip, ref, ref_emb, ref))
                Y.append(torch.tensor([1.0, 1.0, 1.0], device=DEVICE))
                continue

            # 25% cross-reference positives: same visual family, different art.
            # CLIP embeddings of same-style images stay close, so the model
            # learns "close embedding + similar colors → high style/palette".
            if roll < 0.37 and len(refs) > 1:
                other = random.choice([r for r in refs if r is not ref])
                X.append(_featurize(clip, ref, ref_emb, other))
                Y.append(torch.tensor(
                    [random.uniform(0.75, 0.95), random.uniform(0.55, 0.8), random.uniform(0.8, 0.95)],
                    device=DEVICE,
                ))
                continue

            s_style = random.uniform(0, 1)   # style perturbation magnitude
            s_pal = random.uniform(0, 1)     # palette drift magnitude
            s_q = random.uniform(0, 1)       # quality degradation magnitude
            # 15% near-zero magnitudes: densely cover the identity neighborhood
            if random.random() < 0.15:
                s_style *= 0.05
                s_pal *= 0.05
                s_q *= 0.05

            img = ref
            # style perturbation: rotation + crop + contrast
            if s_style > 0.05:
                angle = 25 * s_style * random.choice([-1, 1])
                img = img.rotate(angle, resample=Image.BILINEAR)
                w, h = img.size
                crop = 1 - 0.15 * s_style
                img = img.crop((0, 0, int(w * crop), int(h * crop))).resize((w, h))
                img = ImageEnhance.Contrast(img).enhance(1 + 0.4 * s_style * random.choice([-1, 1]))

            # palette drift
            if s_pal > 0.05:
                img = _rand_color_shift(img, s_pal)

            # quality degradation
            if s_q > 0.05:
                img = _degrade(img, blur=3.0 * s_q, noise=0.25 * s_q, jpeg=int(95 - 60 * s_q))

            X.append(_featurize(clip, ref, ref_emb, img))
            Y.append(torch.tensor([1 - s_style, 1 - s_pal, 1 - s_q], device=DEVICE))
    return torch.stack(X), torch.stack(Y)


def train(refs: list[Image.Image], epochs: int = 60, out_path: str = "critic_head.pt") -> CriticHead:
    print(f"[critic] device: {DEVICE}")
    clip = ClipBackend()
    print("[critic] building synthetic dataset from references…")
    X, Y = make_training_pairs(clip, refs)
    print(f"[critic] dataset: {X.shape[0]} samples")

    model = CriticHead().to(DEVICE)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loss_fn = nn.MSELoss()

    # deterministic split
    n = X.shape[0]
    idx = torch.randperm(n)
    n_val = max(1, int(0.15 * n))
    val_idx, tr_idx = idx[:n_val], idx[n_val:]

    for ep in range(epochs):
        model.train()
        perm = tr_idx[torch.randperm(tr_idx.shape[0])]
        total = 0.0
        for i in range(0, perm.shape[0], 128):
            batch = perm[i : i + 128]
            pred = model(X[batch])
            loss = loss_fn(pred, Y[batch])
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += float(loss) * batch.shape[0]
        sched.step()

        model.eval()
        with torch.no_grad():
            vp = model(X[val_idx])
            val_loss = float(loss_fn(vp, Y[val_idx]))
        print(f"[critic] epoch {ep+1:02d}/{epochs}  train {total/ (tr_idx.shape[0]):.4f}  val {val_loss:.4f}")

    torch.save(model.state_dict(), out_path)
    print(f"[critic] saved → {out_path}")
    return model


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------
def load_head(path: str = "critic_head.pt") -> CriticHead:
    model = CriticHead().to(DEVICE)
    model.load_state_dict(torch.load(path, map_location=DEVICE))
    model.eval()
    return model


def score(clip: ClipBackend, head: CriticHead, refs: list[Image.Image], cand: Image.Image) -> CriticVerdict:
    """Score a candidate asset against the project's reference images."""
    per_ref = []
    for ref in refs:
        feats = _featurize(clip, ref, clip.embed(ref), cand)
        with torch.no_grad():
            out = head(feats.unsqueeze(0)).squeeze(0)
        per_ref.append(out)

    out = torch.stack(per_ref).mean(dim=0)  # average across references
    style, palette, quality = (float(x) for x in out)

    notes = (
        f"Compared against {len(refs)} reference asset(s). "
        f"Style consistency {style*100:.0f}/100, palette match {palette:.2f}, "
        f"technical quality {quality*100:.0f}/100. "
        + ("Strong alignment with the project's creative memory." if style > 0.75 and palette > 0.7
           else "Drift detected vs. the project's style guide — consider a revision pass.")
    )
    return CriticVerdict(
        style_score=round(style * 100, 1),
        palette_match=round(palette, 2),
        quality=round(quality * 100, 1),
        notes=notes,
    )
