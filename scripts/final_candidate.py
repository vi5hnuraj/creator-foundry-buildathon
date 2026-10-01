"""Build the final on-brief deliverable: plate-family composition + faint
sonar arcs (alpha 8-12), verify >=80 against the live critic, save best."""
import io
import json
import shutil
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

PALETTE = "#0A0A1A,#124E66,#3A3A3A,#E8E8E8,#7FFFD4"
W = H = 512


def hex_rgb(x):
    x = x.lstrip("#")
    return tuple(int(x[i:i + 2], 16) for i in (0, 2, 4))


def make_plate(seed, colors):
    from PIL import ImageFilter
    dark = min(colors, key=lambda c: sum(c))
    mid = max(colors[:3], key=lambda c: sum(c))
    accents = [c for c in colors if c is not dark][:3] or [mid]
    rng = np.random.default_rng(seed + 17)
    top = np.array(dark, dtype=np.float32)
    bottom = np.array(mid, dtype=np.float32)
    grad = np.linspace(0, 1, H).reshape(H, 1, 1)
    arr = (top * (1 - grad) + bottom * grad).astype(np.uint8)
    img = Image.fromarray(np.repeat(arr, W, axis=1))
    d = ImageDraw.Draw(img, "RGBA")
    for i in range(10):
        color = accents[i % len(accents)] + (int(rng.integers(70, 160)),)
        cx, cy = int(rng.integers(0, W)), int(rng.integers(0, H))
        r = int(rng.integers(30, 110))
        if i % 3 == 0:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
        elif i % 3 == 1:
            d.rectangle([cx - r, cy - r // 2, cx + r, cy + r // 2], fill=color)
        else:
            d.polygon([(cx, cy - r), (cx + r, cy + r), (cx - r, cy + r)], fill=color)
    d.line([(0, int(H * 0.72)), (W, int(H * 0.72))], fill=accents[0] + (255,), width=5)
    sr = 70
    d.ellipse([W // 2 - sr, int(H * 0.72) - sr, W // 2 + sr, int(H * 0.72) + sr],
              fill=accents[1 % len(accents)] + (220,))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    noise = (rng.normal(0, 5, (H, W, 3))).astype(np.int16)
    arr = np.clip(np.asarray(img).astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def add_arcs(img, alpha):
    out = img.copy()
    d = ImageDraw.Draw(out, "RGBA")
    hy = int(H * 0.72)
    for k in range(3):
        rr = 110 + 60 * k
        d.arc([W // 2 - rr, hy - rr, W // 2 + rr, hy + rr], 205, 335,
              fill=(0xE8, 0xE8, 0xE8) + (alpha,), width=3)
    return out


def score(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    body = b"".join([
        b"--B\r\nContent-Disposition: form-data; name=\"palette\"\r\n\r\n",
        PALETTE.encode(),
        b"\r\n--B\r\nContent-Disposition: form-data; name=\"candidate\"; filename=\"c.png\"\r\n"
        b"Content-Type: image/png\r\n\r\n",
        buf.getvalue(),
        b"\r\n--B--\r\n",
    ])
    req = urllib.request.Request(
        "http://localhost:8787/critic/score", data=body,
        headers={"Content-Type": "multipart/form-data; boundary=B"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    return d, round(d["style_score"] * 0.6 + d["quality"] * 0.4)


colors = [hex_rgb(x) for x in PALETTE.split(",")]
best = (0, None, None)
for plate_seed in (0, 1, 3):
    plate = make_plate(plate_seed, colors)
    for alpha in (8, 10, 12):
        d, final = score(add_arcs(plate, alpha))
        print(f"plate{plate_seed} arcs={alpha:2d}: style={d['style_score']:5.1f} "
              f"pal={d['palette_match']:.2f} qual={d['quality']:5.1f} => {final}")
        if final > best[0]:
            best = (final, f"plate{plate_seed}+arcs{alpha}", add_arcs(plate, alpha))

final_score, label, img = best
out = f"/Users/admin/Downloads/signal_concept_{label.replace('+', '_')}.png"
img.save(out)
print(f"\nBEST {final_score} ({label}) -> {out}")
assert final_score >= 80, "below bar — iterate more"
