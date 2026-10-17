# Renders the FollowCheck app icon: two overlapping circles (you and them);
# the shared lens, the mutual relationship, carries the signal colour.
import sys
from PIL import Image, ImageDraw, ImageChops
S = 4096
img = Image.new("RGB", (S, S))
d = ImageDraw.Draw(img)
top, bottom = (0x1D, 0x20, 0x19), (0x0A, 0x0B, 0x08)
for y in range(S):
    t = y / (S - 1)
    d.line([(0, y), (S, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
r, off, w = S * 0.222, S * 0.122, S * 0.054
cy = S / 2
centers = [S / 2 - off, S / 2 + off]
def disc(cx, radius):
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)
    return m
lens = ImageChops.multiply(disc(centers[0], r), disc(centers[1], r))
img.paste((0xC8, 0xF5, 0x60), mask=lens)
ink = (0xF1, 0xF0, 0xE8)
for cx in centers:
    ring = ImageChops.subtract(disc(cx, r + w / 2), disc(cx, r - w / 2))
    img.paste(ink, mask=ring)
out = sys.argv[1]
for size in (1024, 180, 128):
    img.resize((size, size), Image.LANCZOS).save(f"{out}/AppIcon-{size}.png")
