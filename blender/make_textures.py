"""Turns the raw source images into tileable PBR texture sets (albedo / normal / roughness)
and procedurally paints the book-spine atlas, the shelf-row panel and the cobweb texture.
Run:  python3 blender/make_textures.py
"""
import os, math, random
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = HERE + '/src_textures', HERE + '/textures'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
R = random.Random(7)


def load_square(name, size=1024, crop=None):
    im = Image.open(f'{SRC}/{name}.png').convert('RGB')
    w, h = im.size
    if crop:
        im = im.crop(crop)
        w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    return np.asarray(im.resize((size, size), Image.LANCZOS)).astype(np.float32) / 255


def tileable(a, frac=0.12):
    """Cross-fade the borders with a half-rolled copy, one axis at a time."""
    for ax in (0, 1):
        n = a.shape[ax]
        t = np.arange(n) / n
        w = np.clip(np.minimum(t, 1 - t) / frac, 0, 1)
        w = w * w * (3 - 2 * w)
        shape = [1, 1, 1]; shape[ax] = n
        w = w.reshape(shape)
        a = a * w + np.roll(a, n // 2, axis=ax) * (1 - w)
    return a


def flatten_light(a, radius=90):
    """Remove large-scale brightness blotches so repeats are less obvious."""
    g = Image.fromarray((a.mean(2) * 255).astype(np.uint8))
    low = np.asarray(g.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255
    return np.clip(a * (low.mean() / np.maximum(low, 0.02))[..., None] ** 0.6, 0, 1)


def grade(a, mul=(1, 1, 1), sat=1.0, gamma=1.0):
    g = a.mean(2, keepdims=True)
    a = g + (a - g) * sat
    return np.clip(a, 0, 1) ** gamma * np.array(mul, np.float32)


def height_to_normal(h, strength=2.0, wrap=True):
    mode = 'wrap' if wrap else 'edge'
    p = np.pad(h, 1, mode=mode)
    dx = (p[1:-1, 2:] - p[1:-1, :-2]) * strength
    dy = (p[2:, 1:-1] - p[:-2, 1:-1]) * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def blur(h, r):
    return np.asarray(Image.fromarray((np.clip(h, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255


def save(a, name, q=88):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(f'{OUT}/{name}.jpg', quality=q)


def pbr(name, src, strength, rough_base, rough_var, crop=None, size=1024, flat=True, **g):
    a = load_square(src, size, crop)
    if flat:
        a = flatten_light(a)
    a = tileable(a)
    h = a.mean(2)
    a2 = grade(a, **g)
    save(a2, name + '_col')
    save(height_to_normal(blur(h, 0.8) * 4, strength), name + '_nrm', 92)
    hn = (h - h.min()) / (h.max() - h.min() + 1e-5)
    rough = np.clip(rough_base + (hn - 0.5) * rough_var, 0.05, 1)
    orm = np.dstack([np.ones_like(rough), rough, np.zeros_like(rough)])  # glTF: G = roughness, B = metal
    save(orm, name + '_orm')


pbr('wood', 'wood', 0.75, 0.52, -0.35, mul=(0.62, 0.52, 0.46), sat=0.9, gamma=1.15)
pbr('floor', 'floor', 2.2, 0.42, -0.45, mul=(0.8, 0.74, 0.68), sat=0.9, gamma=1.1)
pbr('stone', 'stone', 2.0, 0.9, 0.1, mul=(0.62, 0.60, 0.60), sat=0.35, gamma=1.25)

# leaded glass (emissive) - cool moonlit tint, kept fairly dark so bloom stays subtle
gl = tileable(load_square('glass'))
save(grade(gl, mul=(0.55, 0.68, 0.9), sat=0.6, gamma=1.5), 'glass_col')

# carpet runner (592x1792 -> 512x1536 strip, tileable along its length)
c = Image.open(f'{SRC}/carpet.png').convert('RGB').crop((14, 20, 578, 1772)).resize((512, 1536), Image.LANCZOS)
ca = np.asarray(c).astype(np.float32) / 255
save(grade(ca, mul=(0.7, 0.6, 0.6), gamma=1.2), 'carpet_col')
save(height_to_normal(blur(ca.mean(2), 0.6) * 4, 1.2, False), 'carpet_nrm', 92)

# open book pages, portrait, jump-scare face
pg = Image.open(f'{SRC}/page.png').convert('RGB')
w, h = pg.size
pg = pg.crop((int(w * 0.135), int(h * 0.02), int(w * 0.865), int(h * 0.98))).resize((1024, 768), Image.LANCZOS)
pg.save(f'{OUT}/page_col.jpg', quality=88)
po = Image.open(f'{SRC}/portrait.png').convert('RGB').crop((16, 16, 832, 1248)).resize((512, 768), Image.LANCZOS)
save(grade(np.asarray(po).astype(np.float32) / 255, mul=(0.85, 0.8, 0.75), gamma=1.1), 'portrait_col')

# ---------------------------------------------------------------- book atlas
COLS, CW, AH = 32, 64, 1024
SPH, CVH = 768, 128            # spine rows 0..767, cover leather 768..895, page edges 896..1023
PAL = [(74, 22, 20), (92, 30, 24), (38, 52, 36), (28, 44, 40), (24, 32, 58), (30, 28, 44), (70, 46, 26),
       (96, 66, 36), (120, 92, 58), (40, 28, 22), (26, 24, 24), (104, 84, 62), (58, 20, 34), (86, 72, 40)]
GOLD = np.array([186, 142, 62], np.float32) / 255


def fbm(h, w, oct=5, base=4):
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    for o in range(oct):
        f = base * 2 ** o
        small = rng.random((max(2, h * f // 256), max(2, w * f // 64))).astype(np.float32)
        out += amp * np.asarray(Image.fromarray(small).resize((w, h), Image.BICUBIC))
        amp *= 0.55
    return (out - out.min()) / (out.max() - out.min())


col = np.zeros((AH, COLS * CW, 3), np.float32)
hgt = np.zeros((AH, COLS * CW), np.float32)
for i in range(COLS):
    base = np.array(PAL[i % len(PAL)], np.float32) / 255 * R.uniform(0.75, 1.2)
    n = fbm(AH, CW)
    fine = rng.random((AH, CW)).astype(np.float32)
    x = (np.arange(CW) + 0.5) / CW * 2 - 1
    prof = np.sqrt(np.clip(1 - (x * 0.96) ** 2, 0, 1)) ** 0.6          # rounded spine
    c3 = base[None, None, :] * (0.7 + 0.5 * n[..., None]) * (0.92 + 0.16 * fine[..., None])
    hh = np.tile(prof[None, :] * 0.8, (AH, 1)) + n * 0.06 + fine * 0.02
    sp = slice(0, SPH)
    cloth = R.random() < 0.3
    lay = Image.new('L', (CW, SPH), 0); d = ImageDraw.Draw(lay)       # gilt mask
    bump = Image.new('L', (CW, SPH), 0); db = ImageDraw.Draw(bump)
    lab = Image.new('RGBA', (CW, SPH), (0, 0, 0, 0)); dl = ImageDraw.Draw(lab)
    if not cloth:
        nb = R.choice([3, 4, 4, 5, 5, 6])
        ys = [int(SPH * (k + 1) / (nb + 1) + R.uniform(-8, 8)) for k in range(nb)]
        for y in ys:
            db.rectangle([0, y - 7, CW, y + 7], fill=255)
            if R.random() < 0.8:
                d.line([4, y - 12, CW - 4, y - 12], fill=255, width=2); d.line([4, y + 12, CW - 4, y + 12], fill=255, width=2)
        k = R.randrange(0, max(1, nb - 1))
        y0, y1 = ys[k] + 18, ys[k + 1] - 18 if k + 1 < nb else ys[k] + 120
        if y1 - y0 > 40:
            lc = R.choice([(60, 14, 14), (16, 16, 16), (20, 40, 26), (22, 24, 50)])
            dl.rectangle([6, y0, CW - 7, y1], fill=lc + (235,))
            d.rectangle([6, y0, CW - 7, y1], outline=255, width=1)
            for yy in range(y0 + 8, y1 - 6, 7):
                a_, b_ = R.randint(10, 22), R.randint(40, 54)
                if R.random() < 0.85: d.line([a_, yy, b_, yy], fill=230, width=2)
        if R.random() < 0.6 and nb >= 4:                               # small ornament in another panel
            k2 = (k + 2) % (nb - 1); cy = (ys[k2] + ys[k2 + 1]) // 2
            d.ellipse([CW // 2 - 9, cy - 9, CW // 2 + 9, cy + 9], outline=255, width=2)
            d.line([CW // 2, cy - 14, CW // 2, cy + 14], fill=255, width=1)
        d.line([4, 14, CW - 4, 14], fill=200, width=2); d.line([4, SPH - 14, CW - 4, SPH - 14], fill=200, width=2)
    else:
        y0 = R.randint(90, 240); y1 = y0 + R.randint(90, 170)
        dl.rectangle([8, y0, CW - 9, y1], fill=(196, 178, 140, 240))
        for yy in range(y0 + 10, y1 - 6, 8):
            if R.random() < 0.8: dl.line([14, yy, R.randint(34, 50), yy], fill=(40, 30, 24, 220), width=2)
        weave = (np.sin(np.arange(SPH)[:, None] * 2.1) * np.sin(np.arange(CW)[None, :] * 2.1)) * 0.03
        hh[sp] += weave; c3[sp] *= (1 + weave[..., None] * 2)
    gm = np.asarray(lay).astype(np.float32) / 255 * (0.35 + 0.65 * (n[sp] > 0.3))  # worn gilding
    bm = np.asarray(bump.filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255
    la = np.asarray(lab).astype(np.float32) / 255
    s3 = c3[sp]
    s3 = s3 * (1 - la[..., 3:]) + la[..., :3] * la[..., 3:] * (0.8 + 0.4 * n[sp][..., None])
    s3 = s3 * (1 - gm[..., None]) + GOLD * gm[..., None] * (0.7 + 0.5 * fine[sp][..., None])
    # wear: scuffed head/tail and hinges
    yy = np.arange(SPH)[:, None]
    wear = np.clip(1 - np.minimum(yy, SPH - 1 - yy) / 30, 0, 1) * (n[sp] > 0.35) * 0.5
    wear = np.maximum(wear, (np.abs(x)[None, :] > 0.86) * (n[sp] > 0.5) * 0.4)
    s3 = s3 * (1 - wear[..., None]) + (s3.mean(2, keepdims=True) * 1.5 + 0.12) * wear[..., None]
    s3 *= (0.45 + 0.55 * prof)[None, :, None]                         # baked occlusion between spines
    c3[sp] = s3
    hh[sp] += bm * 0.22 + gm * 0.03
    # cover leather strip
    c3[SPH:SPH + CVH] *= 0.9
    hh[SPH:SPH + CVH] = n[SPH:SPH + CVH] * 0.08
    # page edges
    lines = rng.random((AH - SPH - CVH, 1)).astype(np.float32)
    paper = np.array([0.66, 0.58, 0.44], np.float32) * (0.6 + 0.4 * lines[..., None]) * (0.8 + 0.3 * n[SPH + CVH:][..., None])
    c3[SPH + CVH:] = paper
    hh[SPH + CVH:] = lines * 0.08
    col[:, i * CW:(i + 1) * CW] = c3
    hgt[:, i * CW:(i + 1) * CW] = hh
col *= 0.85
save(col, 'books_col', 90)
bn = height_to_normal(blur(hgt * 0.9, 0.7) * 4, 3.0, False)
save(bn, 'books_nrm', 92)

# shelf-row panel for the (unreachable) gallery shelves: 2048x256, one shelf of books
PW, PH = 2048, 256
pc = np.zeros((PH, PW, 3), np.float32) + 0.012
ph = np.zeros((PH, PW), np.float32)
xx = 0
colim = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8))
hgim = Image.fromarray((np.clip(hgt, 0, 1) * 255).astype(np.uint8))
while xx < PW:
    bw = R.randint(18, 40); bh = int(PH * R.uniform(0.72, 0.97)); k = R.randrange(COLS)
    if R.random() < 0.04:
        xx += R.randint(20, 60); continue
    bw = min(bw, PW - xx)
    sc = np.asarray(colim.crop((k * CW, 0, (k + 1) * CW, SPH)).resize((bw, bh), Image.LANCZOS)).astype(np.float32) / 255
    sh = np.asarray(hgim.crop((k * CW, 0, (k + 1) * CW, SPH)).resize((bw, bh), Image.LANCZOS)).astype(np.float32) / 255
    pc[PH - bh:, xx:xx + bw] = sc * R.uniform(0.75, 1.0)
    ph[PH - bh:, xx:xx + bw] = 0.4 + sh * 0.6
    xx += bw
shade = np.linspace(0.45, 1.0, PH)[:, None, None] ** 0.7            # shadow under the shelf above
save(pc * shade, 'bookrow_col', 90)
save(height_to_normal(blur(ph, 0.8) * 4, 3.0, False), 'bookrow_nrm', 92)

# cobweb (RGBA, corner at top-left)
S = 512
web = Image.new('L', (S, S), 0); d = ImageDraw.Draw(web)
angs = [math.radians(a) for a in (2, 13, 26, 38, 52, 64, 77, 88)]
for a in angs:
    d.line([0, 0, math.cos(a) * S * 1.4, math.sin(a) * S * 1.4], fill=200, width=2)
r = 30
while r < S * 1.3:
    for a0, a1 in zip(angs[:-1], angs[1:]):
        p0 = (math.cos(a0) * r, math.sin(a0) * r); p1 = (math.cos(a1) * r * R.uniform(0.96, 1.04), math.sin(a1) * r)
        mid = ((p0[0] + p1[0]) / 2 * 0.93, (p0[1] + p1[1]) / 2 * 0.93)   # sag toward the corner
        pts = [(p0[0] * (1 - t) ** 2 + 2 * mid[0] * t * (1 - t) + p1[0] * t * t, p0[1] * (1 - t) ** 2 + 2 * mid[1] * t * (1 - t) + p1[1] * t * t) for t in np.linspace(0, 1, 8)]
        if R.random() < 0.9: d.line(pts, fill=150, width=1)
    r += R.uniform(14, 30) * (1 + r / 400)
wa = np.asarray(web.filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32) / 255
haze = fbm(S, S, 4, 2) * np.clip(1 - np.hypot(*np.meshgrid(np.arange(S), np.arange(S))) / (S * 1.05), 0, 1) * 0.35
alpha = np.clip(wa * 0.9 + haze, 0, 1)
fade = np.clip(1.25 - np.hypot(*np.meshgrid(np.arange(S), np.arange(S))) / S, 0, 1)
rgba = np.dstack([np.full((S, S, 3), 0.75, np.float32), alpha * np.clip(fade * 1.3, 0, 1) ** 1.5 * 0.5])
Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').save(f'{OUT}/web.png')
print('textures written to', OUT)
