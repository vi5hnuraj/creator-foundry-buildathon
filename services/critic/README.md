# Creator Foundry — Python Critic Model

A **genuinely trained** ML model that scores creative assets against a
project's style guide: style consistency, palette match, and technical
quality (0–100). Its verdict is embedded into the authorship NFT's
on-chain attributes — **verifiable AI review, anchored on Arbitrum**.

```
asset ──► CLIP ViT-B/32 (frozen) ──► 512-d embedding ─┐
reference ──► CLIP ──► 512-d embedding ───────────────┤
                                                      ▼
                                        trained MLP head (ours)
                                        ├─ style_score   0–100
                                        ├─ palette_match 0–1
                                        └─ quality        0–100
```

## Why trained-not-prompted

LLM judges are unverifiable and non-reproducible. This model is a
deterministic regressor: same inputs → same scores → the score minted on-chain
is *evidence*, not an opinion. It trains in ~1 minute on a MacBook (MPS) from a
fully synthetic dataset (controlled distortions with known labels), so there is
no dataset licensing issue either.

## Quickstart

```bash
cd services/critic          # from the repo root
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python train.py                 # ~1-2 min → critic_head.pt + ref_*.png
uvicorn serve:app --port 8787   # serves POST /critic/score
```

Or, once the venv exists, from the repo root: `npm run critic`.

Smoke test:

```bash
curl -s -F "candidate=@ref_1.png" http://localhost:8787/critic/score
# {"style_score": 92.3, "palette_match": 0.88, "quality": 95.1, "notes": "...", "model": "clip-critic-v1"}
```

## App integration

Set in the Next.js `.env.local`:

```env
CRITIC_SERVICE_URL=http://localhost:8787
```

The orchestrator's critic calls then prefer this service and fall back to the
built-in simulation if it's unreachable. Returned scores are attached to the
bounty review and minted into the NFT's attributes:

```
attributes: CriticStyle=94, CriticPalette=0.91, CriticQuality=96, CriticModel=clip-critic-v1
```

## Files

| File | Purpose |
|---|---|
| `critic.py` | Model + synthetic data + training + inference |
| `train.py` | Entry point: builds references, trains, self-checks |
| `serve.py` | FastAPI service (`/health`, `/critic/score`) |
| `critic_head.pt` | Trained weights (generated) |
| `ref_*.png` | Synthetic reference images (generated) |
