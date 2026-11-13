"""
Generate every ORPHEUS icon (website favicon, PWA, iPhone/iPad, Windows app) from ONE image.

    python make-icons.py                       # uses icon-source.png next to this file
    python make-icons.py my-logo.png           # or any PNG / JPG / WEBP
    python make-icons.py my-logo.png "#101010" # optional flat background colour instead of the dark gradient

The source can be:
  * a logo with a transparent background, or
  * a logo sitting on a dark tile / black background (like the current lyre): the light symbol is cut out
    automatically, so the black margins and old rounded corners of the source never end up in the icons.
The icons are rebuilt cleanly: same background, same symbol size and position in every file,
transparent corners where a rounded icon is expected, full-bleed where the OS does the rounding (iPhone, Android maskable).

Needs:  pip install pillow numpy
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
src = args[0] if args else None
flat = args[1] if len(args) > 1 else None
if not src:
    for cand in ("icon-source.png", "icon-source.jpg", os.path.join("build", "icon.png")):
        if os.path.exists(os.path.join(here, cand)):
            src = os.path.join(here, cand)
            break
if not src or not os.path.exists(src):
    sys.exit("No source image found. Put your icon next to this script as icon-source.png (or pass its path).")

TOP, BOTTOM = (15, 15, 16), (3, 3, 3)   # tile gradient (top -> bottom)
EDGE = (30, 30, 31)                       # thin rim on rounded tiles


def extract_symbol(path):
    """Return the symbol as an RGBA image cropped tight to its bounds."""
    im = Image.open(path).convert("RGBA")
    a = np.array(im.getchannel("A"))
    if a.min() < 250:                                   # already has transparency
        sym = im
    else:                                               # light symbol on a dark background
        rgb = np.array(im.convert("RGB")).astype(float)
        lum = rgb.mean(2)
        core = lum > 120
        ys, xs = np.where(core)
        pad = 14
        box = (max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad, lum.shape[1] - 1), min(ys.max() + pad, lum.shape[0] - 1))
        region = np.zeros_like(lum, bool)
        region[box[1]:box[3] + 1, box[0]:box[2] + 1] = True     # ignore the tile rim / shadow outside the symbol
        local = np.array(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.MaxFilter(9))).astype(float)
        # background level per row (the tile is a slight vertical gradient): median of the dark pixels beside the symbol
        c0, c1 = max(box[0] - 80, 0), min(box[2] + 80, lum.shape[1])
        bgl = np.zeros_like(lum)
        for y in range(lum.shape[0]):
            row = lum[y, c0:c1]
            row = row[(row < 30) & (row > 0)]
            bgl[y] = np.median(row) if row.size else 0
        bgl = np.convolve(bgl[:, 0], np.ones(15) / 15, mode="same")[:, None] * np.ones((1, lum.shape[1]))
        alpha = np.clip((lum - bgl) / np.maximum(local - bgl, 1), 0, 1) * region
        alpha[(local - bgl) < 40] = 0                     # nothing bright nearby = background noise
        alpha[alpha < 0.05] = 0
        col = np.clip(rgb * (local / np.maximum(lum, 1))[..., None], 0, 255)   # un-premultiply edge pixels
        out = np.dstack([col, alpha * 255]).astype(np.uint8)
        sym = Image.fromarray(out, "RGBA")
    bb = sym.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    return sym.crop(bb)


SYM = extract_symbol(src)
print("symbol:", SYM.size, "from", src)


def background(size, rounded, pad=0.0, rim=True):
    """Gradient tile. rounded=True -> squircle with transparent corners; False -> full-bleed square."""
    if flat:
        c = Image.new("RGB", (1, 1), flat).getpixel((0, 0))
        top = bot = c
    else:
        top, bot = TOP, BOTTOM
    g = np.linspace(0, 1, size)[:, None, None]
    arr = (np.array(top) * (1 - g) + np.array(bot) * g).repeat(size, 1).astype(np.uint8)
    img = Image.fromarray(arr, "RGB").convert("RGBA")
    if not rounded:
        return img
    ss = 4                                              # supersample for smooth edges
    S = size * ss
    inset = size * pad * ss
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    r = (S - 2 * inset) / 2
    u = np.abs((xx + .5 - S / 2) / r)
    v = np.abs((yy + .5 - S / 2) / r)
    inside = (u ** 4 + v ** 4) <= 1                     # squircle (iOS-like)
    m = Image.fromarray((inside * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    if rim and size >= 64:
        ring = (((u ** 4 + v ** 4) <= 1) & ((u ** 4 + v ** 4) > (1 - 0.012 * 4))).astype(np.uint8) * 255
        ring_m = Image.fromarray(ring).resize((size, size), Image.LANCZOS)
        edge = Image.new("RGBA", (size, size), EDGE + (255,))
        img = Image.composite(edge, img, ring_m)
    img.putalpha(m)
    return img


def icon(size, rounded, sym_h, pad=0.0, rim=True):
    img = background(size, rounded, pad, rim)
    h = round(size * sym_h)
    w = round(SYM.width * h / SYM.height)
    s = SYM.resize((w, h), Image.LANCZOS)
    img.alpha_composite(s, ((size - w) // 2, (size - h) // 2))
    return img


def save(img, rel):
    p = os.path.join(here, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, "PNG")
    print("wrote", rel, img.size)


save(icon(192, True, .60, .02), "icons/icon-192.png")
save(icon(512, True, .60, .02), "icons/icon-512.png")
# maskable: Android crops to a circle/squircle -> full-bleed background, symbol inside the central 80% safe circle
save(icon(512, False, .56), "icons/icon-maskable-512.png")
# iPhone / iPad: must be opaque and square, iOS rounds the corners itself
save(icon(180, False, .60), "icons/apple-touch-icon.png")
# browser tab: simpler, symbol bigger so it stays readable when tiny
save(icon(32, True, .74, 0, rim=False), "icons/favicon-32.png")
save(icon(16, True, .76, 0, rim=False), "icons/favicon-16.png")
icon(256, True, .70, 0, rim=False).save(os.path.join(here, "icons", "favicon.ico"),
                                        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])
print("wrote icons/favicon.ico")
# Windows app (Electron builds the .ico from this): a little breathing room around the tile
save(icon(512, True, .60, .04), "build/icon.png")
print("done")
