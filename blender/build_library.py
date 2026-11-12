"""Procedurally models the gothic library in Blender and exports it for the game.

    python3 blender/build_library.py            (uses the `bpy` module, Blender 4.2)

Outputs
    public/assets/library.glb   - the map (one static mesh + a few interactive objects)
    public/assets/level.json    - colliders, key / battery spots, hiding cabinets, candles ...
    blender/out/library.blend   - scene for Cycles renders (see render_preview.py)

Blender axes: X east, Y north, Z up. The game (three.js) uses  x = X, y = Z, z = -Y.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kit import Builder, Frame, R, T, RZ, RX, RY, TAU, pointed, circle, shift, path_normals  # noqa: E402

TEX = HERE + '/textures/'
OUT = os.path.abspath(HERE + '/../public/assets')
os.makedirs(OUT, exist_ok=True)
os.makedirs(HERE + '/out', exist_ok=True)
rad = math.radians

# ------------------------------------------------------------------ dimensions
NX, AX, LY = 4.0, 12.0, 20.0            # nave half width, outer half width, half length
ZB, ZG, ZS, ZAP = 4.2, 4.5, 8.0, 12.8   # aisle ceiling, gallery floor, vault springing, vault apex
PIERS = [-20 + 5 * i for i in range(9)]
STACK_Y = [-17.5 + 2.5 * i for i in range(15)]

PAINT = ((1, 10), (-1, 10), (1, -5), (-1, -15), (1, -15), (-1, 0))
bpy.ops.wm.read_factory_settings(use_empty=True)


# ------------------------------------------------------------------ materials
def make_materials():
    mats = {}

    def img(name, cs='sRGB'):
        im = bpy.data.images.load(TEX + name)
        im.colorspace_settings.name = cs
        return im

    def M(name, col=None, nrm=None, orm=None, tint=(1, 1, 1), rough=0.6, metal=0.0, emit=None, estr=0.0,
          alpha=False, nstr=1.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        tn = None
        if col:
            tn = nt.nodes.new('ShaderNodeTexImage')
            tn.image = img(col)
            if tint != (1, 1, 1):
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
                mix.inputs[0].default_value = 1.0
                nt.links.new(tn.outputs['Color'], mix.inputs[6])
                mix.inputs[7].default_value = (*tint, 1)
                nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
            else:
                nt.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
            if alpha:
                nt.links.new(tn.outputs['Alpha'], bsdf.inputs['Alpha'])
                m.blend_method = 'BLEND'
        else:
            bsdf.inputs['Base Color'].default_value = (*tint, 1)
        if nrm:
            nn = nt.nodes.new('ShaderNodeTexImage')
            nn.image = img(nrm, 'Non-Color')
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = nstr
            nt.links.new(nn.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        if orm:
            on = nt.nodes.new('ShaderNodeTexImage')
            on.image = img(orm, 'Non-Color')
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(on.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        if emit:
            if isinstance(emit, str):
                en = tn if emit == col else nt.nodes.new('ShaderNodeTexImage')
                if emit != col:
                    en.image = img(emit)
                nt.links.new(en.outputs['Color'], bsdf.inputs['Emission Color'])
            else:
                bsdf.inputs['Emission Color'].default_value = (*emit, 1)
            bsdf.inputs['Emission Strength'].default_value = estr
        mats[name] = m

    M('wood', 'wood_col.jpg', 'wood_nrm.jpg', 'wood_orm.jpg')
    M('floor', 'floor_col.jpg', 'floor_nrm.jpg', 'floor_orm.jpg')
    M('stone', 'stone_col.jpg', 'stone_nrm.jpg', rough=0.92)
    M('plaster', 'stone_col.jpg', 'stone_nrm.jpg', tint=(0.5, 0.5, 0.56), rough=0.95)
    M('books', 'books_col.jpg', 'books_nrm.jpg', rough=0.62)
    M('bookrow', 'bookrow_col.jpg', 'bookrow_nrm.jpg', rough=0.65)
    M('glass', None, tint=(0.01, 0.012, 0.02), rough=0.25, emit='glass_col.jpg', estr=1.6)
    M('carpet', 'carpet_col.jpg', 'carpet_nrm.jpg', rough=0.97)
    M('page', 'page_col.jpg', rough=0.85)
    M('portrait', 'portrait_col.jpg', rough=0.45)
    M('web', 'web.png', rough=1.0, alpha=True)
    M('iron', tint=(0.035, 0.035, 0.04), rough=0.55, metal=0.85)
    M('brass', tint=(0.46, 0.33, 0.13), rough=0.38, metal=0.95)
    M('wax', tint=(0.72, 0.66, 0.5), rough=0.5, emit=(1.0, 0.55, 0.2), estr=0.06)
    M('leather', tint=(0.09, 0.035, 0.03), rough=0.6)
    M('paper', tint=(0.55, 0.47, 0.34), rough=0.9)
    M('outside', tint=(0, 0, 0), emit=(0.5, 0.62, 0.85), estr=3.0)
    M('keymetal', tint=(0.75, 0.56, 0.2), rough=0.3, metal=1.0)
    M('battery', tint=(0.1, 0.25, 0.12), rough=0.4, metal=0.3)
    return mats


MATS = make_materials()
b = Builder()
A = {'candles': [], 'keySpots': [], 'batterySpots': [], 'hides': [], 'gallery': [], 'noteSpots': []}
OBJECTS = []   # (name, builder, matrix)


def fbox(fr, s0, s1, z0, z1, d0, d1, m, **k):
    p, q = fr.p(s0, z0, d0), fr.p(s1, z1, d1)
    b.box(tuple(min(p[i], q[i]) for i in range(3)), tuple(max(p[i], q[i]) for i in range(3)), m, **k)


def spot(kind, p, hint):
    A[kind].append({'pos': b.world(p), 'hint': hint})


# =================================================================== architecture
def shell():
    b.quad((-AX, -LY, 0), (2 * AX, 0, 0), (0, 2 * LY, 0), 'floor', ts=1.8, facing=(0, 0, 1))
    b.quad((-1.3, -16.6, 0.012), (2.6, 0, 0), (0, 31.2, 0), 'carpet', facing=(0, 0, 1), uv=(0, 0, 1, 4))

    # ---- outer side walls with lancet windows on the gallery level
    for sx in (-1, 1):
        for i in range(8):
            y0 = PIERS[i]
            fr = Frame((sx * AX, y0, 0), (0, 1, 0), (sx, 0, 0))
            inn = fr.v(0, 0, -1)
            if i % 2 == 0:
                up = [(1.9, 5.4)] + shift(pointed(1.2, 1.0, 6), 2.5, 6.9) + [(3.1, 5.4)]
                b.arch_wall(fr, 0, 5, 0, ZS, [(up, [(1.9, 5.4), (3.1, 5.4)])], 'stone', facing=inn)
                b.band(fr, up, 0.12, -0.05, 0.32, 'stone', faces='fio')
                b.quad(fr.p(1.9, 5.4, 0), fr.v(1.2, 0), fr.v(0, 0, 0.32), 'stone', facing=(0, 0, 1))
                b.quad(fr.p(1.9, 5.4, 0.3), fr.v(1.2, 0), (0, 0, 2.5), 'glass', ts=1.3, facing=inn)
                fbox(fr, 2.47, 2.53, 5.4, 7.85, 0.18, 0.26, 'iron')
                for z in (6.0, 6.6, 7.2):
                    fbox(fr, 1.9, 3.1, z - 0.012, z + 0.012, 0.2, 0.24, 'iron')
            else:
                b.arch_wall(fr, 0, 5, 0, ZS, [], 'stone', facing=inn)
        b.col((sx * AX if sx > 0 else -AX - 1, -LY - 1, 0), (AX + 1 if sx > 0 else -AX, LY + 1, 9))

    # ---- north wall + the great window
    frN = Frame((-AX, LY, 0), (1, 0, 0), (0, 1, 0))
    inn = frN.v(0, 0, -1)
    up = [(9.5, 2.4)] + shift(pointed(5.0, 3.8, 12), 12, 7.0) + [(14.5, 2.4)]
    b.arch_wall(frN, 0, 24, 0, 13.5, [(up, [(9.5, 2.4), (14.5, 2.4)])], 'stone', facing=inn)
    b.band(frN, up, 0.24, -0.1, 0.46, 'stone', faces='fio')
    b.quad(frN.p(9.5, 2.4, 0), frN.v(5, 0), frN.v(0, 0, 0.46), 'stone', facing=(0, 0, 1))
    fbox(frN, 9.2, 14.8, 2.22, 2.4, -0.22, 0, 'stone')
    b.quad(frN.p(9.5, 2.4, 0.42), frN.v(5, 0), (0, 0, 8.45), 'glass', ts=1.5, facing=inn)
    d0, d1 = 0.1, 0.3
    fbox(frN, 11.9, 12.1, 2.4, 8.7, d0, d1, 'stone')
    for c in (10.75, 13.25):
        b.band(frN, shift(pointed(2.3, 2.0, 8), c, 6.6), 0.15, d0, d1, 'stone')
        fbox(frN, c - 0.05, c + 0.05, 2.4, 8.5, d0 + 0.03, d1 - 0.03, 'stone')
        for c2 in (c - 0.575, c + 0.575):
            b.band(frN, shift(pointed(1.05, 0.8, 5), c2, 6.1), 0.07, d0 + 0.03, d1 - 0.03, 'stone')
    b.band(frN, shift(circle(0.82, 24), 12, 9.35), 0.14, d0, d1, 'stone', closed=True)
    b.band(frN, shift(circle(0.24, 12), 12, 9.35), 0.07, d0 + 0.03, d1 - 0.03, 'stone', closed=True)
    for k in range(6):
        a = TAU * k / 6 + 0.26
        b.tube([frN.p(12 + 0.3 * math.cos(a), 9.35 + 0.3 * math.sin(a), 0.2), frN.p(12 + 0.84 * math.cos(a), 9.35 + 0.84 * math.sin(a), 0.2)], 0.045, 'stone', n=4)
    for z in (3.45, 4.5, 5.55):
        fbox(frN, 9.5, 14.5, z - 0.016, z + 0.016, 0.33, 0.37, 'iron')
    b.col((-AX - 1, LY, 0), (AX + 1, LY + 1, 9))

    # ---- south wall: exit door + rose window
    frS = Frame((AX, -LY, 0), (-1, 0, 0), (0, -1, 0))
    inn = frS.v(0, 0, -1)
    door = [(10.7, 0), (10.7, 3.6), (13.3, 3.6), (13.3, 0)]
    b.arch_wall(frS, 0, 24, 0, 5.6, [(door, None)], 'stone', facing=inn)
    b.band(frS, door, 0.32, -0.12, 0.45, 'stone', faces='fio')
    b.band(frS, shift(pointed(3.3, 1.75, 8), 12, 3.95), 0.18, -0.09, 0.0, 'stone', faces='fio')
    cu = [(12 + 1.25 * math.cos(math.pi - math.pi * i / 14), 8.5 + 1.25 * math.sin(math.pi - math.pi * i / 14)) for i in range(15)]
    cl = [(12 + 1.25 * math.cos(math.pi + math.pi * i / 14), 8.5 + 1.25 * math.sin(math.pi + math.pi * i / 14)) for i in range(15)]
    b.arch_wall(frS, 0, 24, 5.6, 13.5, [(cu, cl)], 'stone', facing=inn)
    b.band(frS, shift(circle(1.25, 28), 12, 8.5), 0.2, -0.08, 0.42, 'stone', closed=True, faces='fio')
    b.quad(frS.p(10.7, 7.2, 0.38), frS.v(2.6, 0), (0, 0, 2.6), 'glass', ts=1.3, facing=inn)
    b.band(frS, shift(circle(0.36, 14), 12, 8.5), 0.08, 0.1, 0.26, 'stone', closed=True)
    for k in range(8):
        a = TAU * k / 8
        b.tube([frS.p(12 + 0.42 * math.cos(a), 8.5 + 0.42 * math.sin(a), 0.18), frS.p(12 + 1.27 * math.cos(a), 8.5 + 1.27 * math.sin(a), 0.18)], 0.05, 'stone', n=4)
    b.col((-AX - 1, -LY - 1, 0), (-1.3, -LY, 9))
    b.col((1.3, -LY - 1, 0), (AX + 1, -LY, 9))
    b.col((-1.3, -LY - 0.35, 0), (1.3, -LY - 0.02, 4), 'exitdoor')
    # porch beyond the door: a short stone passage ending in moonlit mist
    b.quad((-1.3, -24.5, 0), (2.6, 0, 0), (0, 4.5, 0), 'stone', ts=2.2, facing=(0, 0, 1))
    b.quad((-1.3, -24.5, 3.6), (2.6, 0, 0), (0, 4.05, 0), 'stone', ts=2.2, facing=(0, 0, -1))
    for sx in (-1, 1):
        b.quad((sx * 1.3, -24.5, 0), (0, 4.05, 0), (0, 0, 3.6), 'stone', ts=2.2, facing=(-sx, 0, 0))
        b.col((sx * 1.3 if sx > 0 else -2.3, -25.5, 0), (2.3 if sx > 0 else -1.3, -LY - 0.4, 4))
    b.quad((-1.3, -24.5, 0), (2.6, 0, 0), (0, 0, 3.6), 'outside', facing=(0, 1, 0))
    b.col((-2.3, -26.5, 0), (2.3, -25.5, 4))

    # ---- piers
    for y in PIERS:
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 3.65, sx * 4.35))
            b.box((x0 - 0.1, y - 0.45, 0), (x1 + 0.1, y + 0.45, 0.45), 'stone', ts=2.2)
            b.box((x0, y - 0.35, 0.45), (x1, y + 0.35, 7.55), 'stone', ts=2.2)
            b.box((x0 - 0.15, y - 0.5, 7.55), (x1 + 0.15, y + 0.5, ZS), 'stone', ts=2.2)
            if (sx, y) not in PAINT:
                b.lathe((sx * 3.62, y, 0.45), [(0.13, 0), (0.13, 0.12), (0.09, 0.16), (0.09, 6.95), (0.14, 7.0), (0.14, 7.1)], 'stone', n=8, ts=2.2)
            b.col((x0 - 0.1, y - 0.45, 0), (x1 + 0.1, y + 0.45, 8))

    for sx in (-1, 1):
        xa, xb = sorted((sx * 4.2, sx * AX))
        # aisle ceiling / gallery floor / gallery ceiling
        b.quad((xa, -LY, ZB), (xb - xa, 0, 0), (0, 2 * LY, 0), 'wood', ts=1.4, facing=(0, 0, -1))
        b.quad((xa, -LY, ZG), (xb - xa, 0, 0), (0, 2 * LY, 0), 'wood', ts=1.4, facing=(0, 0, 1))
        b.quad((3.7 if sx > 0 else -AX, -LY, ZS), (AX - 3.7, 0, 0), (0, 2 * LY, 0), 'wood', ts=1.4, facing=(0, 0, -1))
        for y in STACK_Y:
            hw = 0.14 if y in PIERS else 0.09
            b.box((xa, y - hw, ZB - (0.3 if y in PIERS else 0.2)), (xb, y + hw, ZB), 'wood', grain=0, skip='z+')
        for y in PIERS[1:-1]:
            b.box((xa, y - 0.12, ZS - 0.28), (xb, y + 0.12, ZS), 'wood', grain=0, skip='z+')
        # balcony fascia + moulding
        f0, f1 = sorted((sx * 3.8, sx * 4.2))
        b.box((f0, -LY, 3.85), (f1, LY, ZG), 'wood', grain=1)
        m0, m1 = sorted((sx * 3.73, sx * 3.8))
        b.box((m0, -LY, 4.36), (m1, LY, ZG), 'wood', grain=1)
        b.box((m0 + 0.03 * (sx > 0), -LY, 3.85), (m1 - 0.03 * (sx < 0), LY, 3.93), 'wood', grain=1)
        # railing
        r0, r1 = sorted((sx * 3.9, sx * 3.98))
        for i in range(8):
            ya, yb = PIERS[i] + 0.36, PIERS[i + 1] - 0.36
            b.box((r0, ya, 5.53), (r1, yb, 5.6), 'wood', grain=1)
            b.box((r0 + 0.02, ya, 4.56), (r1 - 0.02, yb, 4.6), 'iron')
            n = int((yb - ya) / 0.13)
            for k in range(1, n):
                y = ya + (yb - ya) * k / n
                w = 0.02 if k % 8 else 0.035
                b.box((sx * 3.94 - w / 2, y - w / 2, 4.6), (sx * 3.94 + w / 2, y + w / 2, 5.53), 'iron', skip='z-z+')
        # triforium arcade on the gallery
        for i in range(8):
            fr = Frame((sx * 3.75, PIERS[i] + 0.35, 0), (0, 1, 0), (sx, 0, 0))
            ops = [(shift(pointed(2.0, 1.25, 7), c, 6.5), None) for c in (1.05, 3.25)]
            b.arch_wall(fr, 0, 4.3, 6.5, ZS, ops, 'stone', d=0, facing=fr.v(0, 0, -1))
            b.arch_wall(fr, 0, 4.3, 6.5, ZS, ops, 'stone', d=0.5, facing=fr.v(0, 0, 1))
            for arch, _ in ops:
                b.band(fr, arch, 0.1, -0.03, 0.53, 'stone', faces='fbi')
            fbox(fr, 1.97, 2.33, 6.28, 6.5, -0.06, 0.56, 'stone', ts=2.2)
            b.lathe(fr.p(2.15, ZG, 0.25), [(0.16, 0), (0.16, 0.1), (0.085, 0.16), (0.085, 1.68), (0.15, 1.78)], 'stone', n=8, ts=2.2)

    # ---- nave vault with ribs
    prof = shift(pointed(8.0, ZAP - ZS, 12), 0, ZS)
    pn = path_normals(prof)
    acc = [0.0]
    for p, q in zip(prof, prof[1:]):
        acc.append(acc[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
    for i in range(8):
        y0, y1 = PIERS[i], PIERS[i + 1]
        for k in range(len(prof) - 1):
            (xa, za), (xb, zb) = prof[k], prof[k + 1]
            na, nb = (-pn[k][0], 0, -pn[k][1]), (-pn[k + 1][0], 0, -pn[k + 1][1])
            b.poly([(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)],
                   [(acc[k] / 3, y0 / 3), (acc[k + 1] / 3, y0 / 3), (acc[k + 1] / 3, y1 / 3), (acc[k] / 3, y1 / 3)],
                   'plaster', normals=[na, nb, nb, na])
    for y in PIERS:
        b.band(Frame((0, y - 0.17, 0), (1, 0, 0), (0, 1, 0)), prof, -0.24, 0, 0.34, 'stone', faces='fbo')
    for y in PIERS[:-1]:
        b.band(Frame((0, y + 2.42, 0), (1, 0, 0), (0, 1, 0)), prof, -0.1, 0, 0.16, 'stone', faces='fbo')
    b.box((-0.11, -LY, ZAP - 0.3), (0.11, LY, ZAP + 0.05), 'stone', grain=1, skip='z+')

    for y in (-12.5, -2.5, 7.5):
        A['gallery'] += [{'pos': (-4.75, y, ZG)}, {'pos': (4.75, y, ZG)}]


# =================================================================== bookcases
def bookcase(L, H=3.0, double=True, d=0.31, fill=0.94, gaps=(), tag=None):
    """local: runs along +x from 0..L, shelves face +y (and -y when double)."""
    yb = -d if double else 0.0
    back = 0.018
    b.box((0.02, yb + 0.02, 0), (L - 0.02, d - 0.02, 0.12), 'wood', grain=0)
    b.box((-0.035, yb - 0.035, H - 0.1), (L + 0.035, d + 0.035, H), 'wood', grain=0)
    b.box((-0.015, yb - 0.015, H - 0.16), (L + 0.015, d + 0.015, H - 0.1), 'wood', grain=0, skip='z+')
    b.box((0, yb, 0.12), (0.05, d, H - 0.16), 'wood', skip='z-z+')
    b.box((L - 0.05, yb, 0.12), (L, d, H - 0.16), 'wood', skip='z-z+')
    b.box((0.05, -back if double else 0.0, 0.12), (L - 0.05, back, H - 0.16), 'wood', skip='z-z+x-x+' + ('' if double else 'y-'))
    nb = max(1, round((L - 0.1) / 1.0))
    bw = (L - 0.1) / nb
    for i in range(1, nb):
        x = 0.05 + i * bw
        b.box((x - 0.02, yb, 0.12), (x + 0.02, d, H - 0.16), 'wood', skip='z-z+')
    rows = int((H - 0.3) / 0.4)
    pitch = (H - 0.28) / rows
    found = {}
    for r in range(rows):
        z = 0.12 + r * pitch
        b.box((0.05, yb + 0.004, z), (L - 0.05, d - 0.004, z + 0.03), 'wood', grain=0, skip='x-x+')
        for side in ((1, -1) if double else (1,)):
            for bay in range(nb):
                x0, x1 = 0.05 + bay * bw + 0.02, 0.05 + (bay + 1) * bw - 0.02
                if (side, r, bay) in gaps:
                    found[(side, r, bay)] = b.world(((x0 + x1) / 2, side * d * 0.62, z + 0.03))
                    # leave it mostly empty: a few books at one end only
                    if side > 0:
                        b.book_row((x0, back, z + 0.03), (1, 0, 0), (0, 1, 0), (x1 - x0) * 0.28, pitch - 0.03, d - back - 0.006, 1.0, z < 1.9)
                    else:
                        b.book_row((x1, -back, z + 0.03), (-1, 0, 0), (0, -1, 0), (x1 - x0) * 0.28, pitch - 0.03, d - back - 0.006, 1.0, z < 1.9)
                    continue
                f = fill if R.random() > 0.06 else fill * 0.5
                if side > 0:
                    b.book_row((x0, back, z + 0.03), (1, 0, 0), (0, 1, 0), x1 - x0, pitch - 0.03, d - back - 0.006, f, z < 1.9)
                else:
                    b.book_row((x1, -back, z + 0.03), (-1, 0, 0), (0, -1, 0), x1 - x0, pitch - 0.03, d - back - 0.006, f, z < 1.9)
    b.col((-0.035, yb - 0.035, 0), (L + 0.035, d + 0.035, H), tag)
    return found


def panel_case(L, H, d=0.3):
    """Cheap shelf for the unreachable gallery: one textured quad per shelf row."""
    b.box((-0.03, -0.0, H - 0.1), (L + 0.03, d + 0.03, H), 'wood', grain=0)
    b.box((0, 0, 0), (L, d, 0.1), 'wood', grain=0)
    nb = max(1, round(L / 1.2))
    for i in range(nb + 1):
        x = (L - 0.04) * i / nb
        b.box((x, 0, 0.1), (x + 0.04, d, H - 0.1), 'wood', skip='z-z+')
    rows = max(1, int((H - 0.2) / 0.4))
    pitch = (H - 0.2) / rows
    for r in range(rows):
        z = 0.1 + r * pitch
        b.box((0.04, 0, z), (L - 0.04, d - 0.005, z + 0.03), 'wood', grain=0, skip='x-x+y-')
        u0 = R.random()
        b.quad((0.04, d - 0.05, z + 0.03), (L - 0.08, 0, 0), (0, 0, pitch - 0.03), 'bookrow', facing=(0, 1, 0),
               uv=(u0, 0.0, u0 + (L - 0.08) / 2.9, 1.0))


def shelves():
    gapsE = {-12.5: [(1, 3, 2)], 7.5: [(-1, 2, 1)], 15.0: [(-1, 3, 0)]}
    gapsW = {-12.5: [(-1, 2, 2)], 2.5: [(1, 3, 1)], 15.0: [(1, 2, 3)], -7.5: [(-1, 3, 0)]}
    skipE, skipW = {0.0, 17.5}, {-2.5, -5.0, -17.5, 10.0}
    kinds = ['keySpots', 'batterySpots']
    n = 0
    for y in STACK_Y:
        if y not in skipE:
            with b.at(T(6.4, y)):
                for p in bookcase(3.8, gaps=gapsE.get(y, ())).values():
                    A[kinds[n % 2 if n > 2 else 0]].append({'pos': p, 'hint': 'on a half-empty shelf in the east stacks'}); n += 1
        if y not in skipW:
            with b.at(T(-10.2, y)):
                for p in bookcase(3.8, gaps=gapsW.get(y, ())).values():
                    A[kinds[n % 2 if n > 2 else 0]].append({'pos': p, 'hint': 'on a half-empty shelf in the west stacks'}); n += 1
    # the toppled stack (west aisle) leaning on its neighbour
    with b.at(T(-10.2, 10.0) @ T(0, 0.345, 0) @ RX(-rad(37.0)) @ T(0, -0.345, 0)):
        bookcase(3.8, fill=0.45)
        b.colliders.pop()
    b.col((-10.25, 9.6, 0), (-6.35, 12.2, 2.7))

    # wall shelves, interrupted by the hiding cabinets
    def wall_run(x, ang, ya, yb, cabs):
        cuts = sorted(cabs)
        segs, cur = [], ya
        for c in cuts:
            segs.append((cur, c - 0.68)); cur = c + 0.68
        segs.append((cur, yb))
        for s0, s1 in segs:
            if s1 - s0 < 0.6:
                continue
            with b.at(T(x, s0 if ang > 0 else s1) @ RZ(ang)):
                bookcase(s1 - s0, double=False)
    wall_run(11.98, math.pi / 2, -19.55, 19.55, HIDE_E)
    wall_run(-11.98, -math.pi / 2, -19.55, 19.55, HIDE_W)
    for x, L in ((11.6, 1.4), (7.25, 2.8)):          # north wall, east aisle (card catalogues sit between)
        with b.at(T(x, 19.98) @ RZ(math.pi)):
            bookcase(L, double=False)
    with b.at(T(-4.45, 19.98) @ RZ(math.pi)):
        bookcase(7.15, double=False)
    with b.at(T(4.45, -19.98)):
        bookcase(7.15, double=False)
    for x, L in ((-11.6, 2.9), (-7.3, 2.85)):
        with b.at(T(x, -19.98)):
            bookcase(L, double=False)

    # gallery shelves (panel type). Low under the windows, tall elsewhere.
    for sx in (-1, 1):
        for i in range(8):
            H = 0.85 if i % 2 == 0 else 3.1
            y0, y1 = PIERS[i] + 0.1, PIERS[i + 1] - 0.1
            with b.at(T(sx * 11.98, y0 if sx > 0 else y1, ZG) @ RZ(sx * math.pi / 2)):
                panel_case(y1 - y0, H)
        for y in PIERS[1:-1:2]:                      # a few free-standing stacks up there for depth
            with b.at(T(sx * 7.2 if sx > 0 else sx * 10.4, y + 2.5, ZG)):
                panel_case(3.2, 2.6)
            with b.at(T(sx * 10.4 if sx > 0 else sx * 7.2, y + 2.5, ZG) @ RZ(math.pi)):
                panel_case(3.2, 2.6)


# =================================================================== furniture
def turned_leg(x, y, h):
    b.lathe((x, y, 0), [(0.03, 0), (0.035, 0.05), (0.025, 0.1), (0.04, h * 0.45), (0.025, h * 0.75), (0.045, h * 0.82), (0.045, h)], 'wood', n=8, ts=0.6)


def table(L=2.4, W=1.0, H=0.78):
    b.box((-L / 2, -W / 2, H - 0.045), (L / 2, W / 2, H), 'wood', grain=0)
    b.box((-L / 2 + 0.08, -W / 2 + 0.08, H - 0.15), (L / 2 - 0.08, W / 2 - 0.08, H - 0.045), 'wood', grain=0, skip='z+')
    for sx in (-1, 1):
        for sy in (-1, 1):
            turned_leg(sx * (L / 2 - 0.12), sy * (W / 2 - 0.12), H - 0.15)
        b.box((sx * (L / 2 - 0.12) - 0.02, -W / 2 + 0.12, 0.14), (sx * (L / 2 - 0.12) + 0.02, W / 2 - 0.12, 0.19), 'wood', grain=1)
    b.box((-L / 2 + 0.12, -0.02, 0.14), (L / 2 - 0.12, 0.02, 0.19), 'wood', grain=0)
    b.col((-L / 2, -W / 2, 0), (L / 2, W / 2, H))


def chair(collide=True):
    """local: seat centred on origin, sitter faces +y."""
    s, h = 0.22, 0.46
    b.box((-s, -s, h - 0.04), (s, s, h), 'wood', grain=1)
    for sx in (-1, 1):
        b.box((sx * s - 0.02 * (sx > 0) - 0.02 * (sx > 0), s - 0.04, 0), (sx * s + 0.04 * (sx < 0), s, h - 0.04), 'wood', skip='z+')
        x0 = sx * s - (0.04 if sx > 0 else 0)
        b.box((x0, -s, 0), (x0 + 0.04, -s + 0.04, 1.02), 'wood')
        b.box((x0 + 0.01, -s + 0.04, 0.2), (x0 + 0.03, s - 0.04, 0.23), 'wood', grain=1)
    b.box((-s + 0.04, -s + 0.005, 0.9), (s - 0.04, -s + 0.035, 1.0), 'wood', grain=0)
    b.box((-s + 0.04, -s + 0.01, 0.58), (s - 0.04, -s + 0.03, 0.63), 'wood', grain=0)
    for k in range(4):
        x = -s + 0.09 + k * (2 * s - 0.18) / 3
        b.box((x - 0.012, -s + 0.012, 0.63), (x + 0.012, -s + 0.028, 0.9), 'wood', skip='z-z+')
    if collide:
        b.col((-s, -s, 0), (s, s, 1.0))


def candle(p, h=0.14, r=0.014):
    b.lathe(p, [(r, 0), (r, h), (r * 0.4, h + 0.004), (0, h + 0.004)], 'wax', n=7)
    b.tube([(p[0], p[1], p[2] + h), (p[0] + 0.002, p[1], p[2] + h + 0.014)], 0.0015, 'iron', n=3)
    return b.world((p[0], p[1], p[2] + h + 0.03))


def candelabra(lit=True, arms=3):
    b.lathe((0, 0, 0), [(0, 0), (0.2, 0), (0.2, 0.025), (0.07, 0.07), (0.028, 0.12), (0.022, 0.68), (0.05, 0.72), (0.022, 0.77),
                        (0.022, 1.3), (0.05, 1.36), (0.055, 1.4), (0, 1.4)], 'iron', n=10)
    flames = [candle((0, 0, 1.4), 0.18)]
    for k in range(arms):
        a = TAU * k / arms + 0.4
        c, s = math.cos(a), math.sin(a)
        b.tube([(0, 0, 1.12), (0.1 * c, 0.1 * s, 1.03), (0.2 * c, 0.2 * s, 1.03), (0.27 * c, 0.27 * s, 1.1), (0.28 * c, 0.28 * s, 1.24)], 0.011, 'iron', n=5)
        b.lathe((0.28 * c, 0.28 * s, 1.24), [(0, 0), (0.035, 0.008), (0.045, 0.03), (0.0, 0.03)], 'iron', n=7)
        flames.append(candle((0.28 * c, 0.28 * s, 1.27), R.uniform(0.09, 0.16)))
    b.col((-0.14, -0.14, 0), (0.14, 0.14, 1.5))
    A['candles'].append({'pos': b.world((0, 0, 1.62)), 'flames': flames, 'lit': lit, 'kind': 'floor'})


def candlestick(lit=True):
    b.lathe((0, 0, 0), [(0, 0), (0.06, 0), (0.06, 0.012), (0.02, 0.03), (0.014, 0.1), (0.03, 0.12), (0.012, 0.14), (0.034, 0.17), (0.04, 0.185), (0, 0.185)], 'brass', n=9)
    f = candle((0, 0, 0.185), R.uniform(0.06, 0.15), 0.013)
    A['candles'].append({'pos': b.world((0, 0, 0.5)), 'flames': [f], 'lit': lit, 'kind': 'table'})


def chandelier(z=7.2):
    Rr = 1.25
    ring = [(Rr * math.cos(TAU * i / 20), Rr * math.sin(TAU * i / 20), z) for i in range(20)]
    b.tube(ring, 0.028, 'iron', n=6, closed=True)
    ring2 = [(0.55 * math.cos(TAU * i / 12), 0.55 * math.sin(TAU * i / 12), z + 0.55) for i in range(12)]
    b.tube(ring2, 0.02, 'iron', n=5, closed=True)
    flames = []
    for k in range(8):
        a = TAU * k / 8
        c, s = math.cos(a), math.sin(a)
        b.lathe((Rr * c, Rr * s, z + 0.02), [(0, 0), (0.04, 0.008), (0.05, 0.035), (0, 0.035)], 'iron', n=7)
        flames.append(candle((Rr * c, Rr * s, z + 0.055), R.uniform(0.08, 0.16), 0.016))
        if k % 2 == 0:
            b.tube([(Rr * c, Rr * s, z), (0.55 * c, 0.55 * s, z + 0.55), (0, 0, z + 1.7)], 0.008, 'iron', n=4)
            b.tube([(Rr * c, Rr * s, z), (0, 0, z - 0.25)], 0.012, 'iron', n=4)
    b.lathe((0, 0, z - 0.32), [(0, 0), (0.06, 0.04), (0.03, 0.1), (0.03, 0.2)], 'iron', n=8)
    b.tube([(0, 0, z + 1.7), (0, 0, ZAP - 0.28)], 0.012, 'iron', n=5)
    A['candles'].append({'pos': b.world((0, 0, z + 0.25)), 'flames': flames, 'lit': True, 'kind': 'chandelier'})


def open_book():
    b.box((-0.24, -0.16, 0), (0.24, 0.16, 0.012), 'leather')
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.004, sx * 0.23))
        b.box((x0, -0.15, 0.012), (x1, 0.15, 0.034), 'paper', skip='z+z-')
        b.quad((x0, -0.15, 0.034), (x1 - x0, 0, 0), (0, 0.3, 0), 'page', facing=(0, 0, 1), uv=(0.0 if sx < 0 else 0.5, 0, 0.5 if sx < 0 else 1.0, 1))


FLAT = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))  # book thickness -> up


def floor_books(cx, cy, n, rx, ry, z=0.0):
    for _ in range(n):
        x, y = cx + R.uniform(-rx, rx), cy + R.uniform(-ry, ry)
        if R.random() < 0.12:
            with b.at(T(x, y, z + 0.002) @ RZ(R.uniform(0, TAU))):
                open_book()
        else:
            with b.at(T(x, y, z + 0.001) @ RZ(R.uniform(0, TAU)) @ RX(R.uniform(-0.03, 0.03)) @ FLAT):
                b.book_box(R.uniform(0.025, 0.06), R.uniform(0.2, 0.32), R.uniform(0.14, 0.21))


def pile(x, y, n, z=0.0):
    for _ in range(n):
        w = R.uniform(0.03, 0.065)
        with b.at(T(x + R.uniform(-0.02, 0.02), y + R.uniform(-0.02, 0.02), z) @ RZ(R.uniform(-0.5, 0.5)) @ FLAT):
            b.book_box(w, R.uniform(0.22, 0.32), R.uniform(0.16, 0.21))
        z += w
    return z


def desk():
    L, W, H = 2.3, 1.0, 0.8
    b.box((-L / 2, -W / 2, H - 0.05), (L / 2, W / 2, H), 'wood', grain=0)
    b.box((-L / 2 + 0.12, -W / 2 + 0.12, H), (L / 2 - 0.12, W / 2 - 0.12, H + 0.004), 'leather', skip='z-')
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.45, sx * (L / 2 - 0.05)))
        b.box((x0, -W / 2 + 0.05, 0.06), (x1, W / 2 - 0.05, H - 0.05), 'wood')
        b.box((x0 - 0.02, -W / 2 + 0.03, 0), (x1 + 0.02, W / 2 - 0.03, 0.06), 'wood', grain=0)
        for k in range(3):
            z0 = 0.1 + k * 0.215
            b.box((x0 + 0.04, W / 2 - 0.05, z0), (x1 - 0.04, W / 2 - 0.035, z0 + 0.19), 'wood', grain=0)
            b.lathe(((x0 + x1) / 2, W / 2 - 0.035, z0 + 0.095), [(0.0, 0), (0.014, 0.0), (0.018, 0.02), (0, 0.025)], 'brass', n=6)
    b.box((-0.45, -W / 2 + 0.05, 0.25), (0.45, -W / 2 + 0.08, H - 0.05), 'wood', grain=0)
    b.col((-L / 2, -W / 2, 0), (L / 2, W / 2, H))


def catalog():
    Wd, D, H = 1.4, 0.5, 1.25
    b.box((0, 0, 0.12), (Wd, D, H), 'wood')
    b.box((-0.03, -0.0, H), (Wd + 0.03, D + 0.03, H + 0.04), 'wood', grain=0)
    b.box((0.03, 0.03, 0), (Wd - 0.03, D - 0.03, 0.12), 'wood', grain=0)
    for i in range(7):
        for j in range(6):
            x0, z0 = 0.045 + i * 0.19, 0.17 + j * 0.175
            out = 0.012 + (0.1 if R.random() < 0.06 else 0)
            b.box((x0, D, z0), (x0 + 0.165, D + out, z0 + 0.15), 'wood', grain=0, skip='y-')
            b.box((x0 + 0.045, D + out, z0 + 0.07), (x0 + 0.12, D + out + 0.006, z0 + 0.115), 'brass', skip='y-')
            b.lathe((x0 + 0.0825, D + out, z0 + 0.04), [(0.0, 0), (0.008, 0.0), (0.011, 0.014), (0, 0.018)], 'brass', n=5)
    b.col((0, 0, 0), (Wd, D + 0.02, H))


def globe():
    b.lathe((0, 0, 0), [(0, 0), (0.24, 0), (0.24, 0.035), (0.06, 0.09), (0.04, 0.5), (0.07, 0.56), (0.03, 0.6), (0.03, 0.64)], 'wood', n=10, ts=0.6)
    with b.at(T(0, 0, 0.94) @ RY(rad(23))):
        b.sphere((0, 0, 0), 0.25, 'page', 16, uvrect=(0.03, 0.05, 0.97, 0.95))
        b.tube([(0.285 * math.cos(TAU * i / 20), 0, 0.285 * math.sin(TAU * i / 20)) for i in range(20)], 0.009, 'brass', n=5, closed=True)
        b.tube([(0, 0, -0.3), (0, 0, 0.3)], 0.006, 'brass', n=4)
    b.col((-0.25, -0.25, 0), (0.25, 0.25, 1.2))


def lectern():
    b.box((-0.25, -0.22, 0), (0.25, 0.22, 0.06), 'wood', grain=0)
    b.box((-0.07, -0.07, 0.06), (0.07, 0.07, 1.02), 'wood')
    with b.at(T(0, 0.04, 1.06) @ RX(rad(24))):
        b.box((-0.33, -0.24, -0.03), (0.33, 0.24, 0), 'wood', grain=0)
        b.box((-0.33, -0.24, 0), (0.33, -0.215, 0.03), 'wood', grain=0)
        with b.at(T(0, -0.02, 0)):
            open_book()
    b.col((-0.25, -0.22, 0), (0.25, 0.22, 1.2))


def ladder(Lz=3.15):
    for sx in (-1, 1):
        b.box((sx * 0.22 - 0.02, -0.015, 0), (sx * 0.22 + 0.02, 0.015, Lz), 'wood')
    z = 0.28
    while z < Lz - 0.1:
        b.tube([(-0.22, 0, z), (0.22, 0, z)], 0.014, 'wood', n=5)
        z += 0.29


def cobweb(p0, du, dv):
    b.quad(p0, du, dv, 'web', uv=(0, 1, 1, 0))


def painting(fr):
    fbox(fr, -0.36, 0.36, 1.42, 2.6, -0.035, 0, 'wood')
    for s0, s1, z0, z1 in ((-0.4, 0.4, 1.38, 1.46), (-0.4, 0.4, 2.56, 2.64), (-0.4, -0.32, 1.46, 2.56), (0.32, 0.4, 1.46, 2.56)):
        fbox(fr, s0, s1, z0, z1, -0.07, 0, 'brass')
    b.quad(fr.p(-0.32, 1.46, -0.04), fr.v(0.64, 0), (0, 0, 1.1), 'portrait', facing=fr.v(0, 0, -1), uv=(0.04, 0.06, 0.96, 0.94))


# ---------------------------------------------------------------- separate objects
HIDE_E, HIDE_W = [-8.75, 13.75], [3.75, -13.75]


def hide_cabinet(M, idx):
    """Wardrobe the player can hide in. local: x +-0.6, back y=0, front y=0.75."""
    with b.at(M):
        b.box((-0.6, 0, 0), (0.6, 0.03, 2.2), 'wood')
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 0.56, sx * 0.6))
            b.box((x0, 0.03, 0), (x1, 0.75, 2.2), 'wood')
        b.box((-0.56, 0.03, 0), (0.56, 0.75, 0.1), 'wood', grain=0)
        b.box((-0.64, 0, 2.12), (0.64, 0.79, 2.22), 'wood', grain=0)
        b.box((-0.66, 0, 2.22), (0.66, 0.81, 2.26), 'wood', grain=0)
        b.col((-0.62, 0, 0), (0.62, 0.78, 2.26), f'hide{idx}')
        A['hides'].append({'id': idx, 'pos': b.world((0, 0.4, 0)), 'front': b.world((0, 1.45, 0))})
        cobweb((-0.64, 0.8, 2.26), (0.5, 0, 0), (0, 0, -0.5))
    for side in (-1, 1):
        d = Builder()
        w = 0.555 * -side          # leaf extends towards the middle
        x0, x1 = sorted((0, w))
        d.box((x0, -0.03, 0.1), (x1, 0, 2.12), 'wood')
        d.box((x0 + 0.07, 0, 0.2), (x1 - 0.07, 0.008, 1.0), 'wood')
        d.box((x0 + 0.07, 0, 1.1), (x1 - 0.07, 0.008, 2.02), 'wood')
        d.lathe((w - 0.05 * -side, 0.0, 1.05), [(0, 0), (0.012, 0), (0.02, 0.025), (0, 0.03)], 'brass', n=7)
        OBJECTS.append((f'HideDoor{"L" if side < 0 else "R"}_{idx}', d, M @ T(side * 0.555, 0.75, 0)))


def exit_doors():
    for side in (-1, 1):
        d = Builder()
        w = 1.29 * -side
        x0, x1 = sorted((0, w))
        d.box((x0, -0.05, 0.01), (x1, 0.05, 3.58), 'wood')
        n = 6
        for k in range(1, n):                       # plank grooves
            x = x0 + (x1 - x0) * k / n
            d.box((x - 0.004, 0.05, 0.01), (x + 0.004, 0.052, 3.58), 'iron', skip='y-')
        for z in (0.5, 1.8, 3.1):                   # strap hinges
            d.box((min(0, w * 0.9), 0.05, z - 0.045), (max(0, w * 0.9), 0.066, z + 0.045), 'iron')
            for k in range(5):
                x = w * (0.1 + k * 0.18)
                d.lathe((x, 0.066, z), [(0, 0), (0.018, 0), (0.012, 0.012), (0, 0.014)], 'iron', n=6)
        hx = w - 0.16 * -side
        d.tube([(hx + 0.075 * math.cos(TAU * i / 14), 0.085, 1.25 + 0.075 * math.sin(TAU * i / 14)) for i in range(14)], 0.011, 'iron', n=5, closed=True)
        d.box((hx - 0.05, 0.05, 1.3), (hx + 0.05, 0.075, 1.36), 'iron')
        OBJECTS.append((f'ExitDoor{"L" if side < 0 else "R"}', d, T(side * 1.29, -LY - 0.12, 0)))
    for i, z in enumerate((0.95, 1.45, 1.95)):
        d = Builder()
        d.box((-0.22, -0.012, -0.04), (0.22, 0.012, 0.04), 'iron')
        d.box((-0.065, 0.012, -0.17), (0.065, 0.062, -0.03), 'brass')
        d.tube([(-0.035, 0.037, -0.03), (-0.035, 0.037, 0.03), (-0.02, 0.037, 0.06), (0.02, 0.037, 0.06), (0.035, 0.037, 0.03), (0.035, 0.037, -0.03)], 0.011, 'iron', n=6)
        d.lathe((0, 0.062, -0.11), [(0, 0), (0.014, 0), (0.014, 0.004), (0, 0.004)], 'iron', n=8)
        OBJECTS.append((f'Lock{i}', d, T(0, -LY - 0.052, z)))


def pickups():
    k = Builder()                                   # skeleton key, lying flat, shaft along +x
    k.tube([(-0.026 + 0.026 * math.cos(TAU * i / 16), 0.026 * math.sin(TAU * i / 16), 0.006) for i in range(16)], 0.0055, 'keymetal', n=6, closed=True)
    k.tube([(-0.026 + 0.011 * math.cos(TAU * i / 8), 0.011 * math.sin(TAU * i / 8), 0.006) for i in range(8)], 0.003, 'keymetal', n=4, closed=True)
    k.tube([(0.0, 0, 0.006), (0.1, 0, 0.006)], 0.005, 'keymetal', n=7)
    for x in (0.004, 0.016):
        k.tube([(x, 0, 0.006), (x + 0.004, 0, 0.006)], 0.008, 'keymetal', n=7)
    k.box((0.078, -0.026, 0.0035), (0.098, 0, 0.0085), 'keymetal')
    k.box((0.062, -0.018, 0.0035), (0.07, 0, 0.0085), 'keymetal')
    OBJECTS.append(('Key', k, T(0, 0, -5)))
    t = Builder()                                   # battery, lying on its side
    with t.at(T(-0.03, 0, 0.016) @ RY(rad(90))):
        t.lathe((0, 0, 0), [(0, 0), (0.016, 0), (0.016, 0.056)], 'battery', n=10)
        t.lathe((0, 0, 0.056), [(0.016, 0), (0.007, 0), (0.007, 0.006), (0, 0.006)], 'brass', n=10)
        t.lathe((0, 0, 0.012), [(0.0165, 0), (0.0165, 0.012)], 'brass', n=10)
    OBJECTS.append(('Battery', t, T(0, 0, -5)))


# =================================================================== dressing
def furnish():
    # ---- librarian's desk beneath the great window
    with b.at(T(0, 16.4)):
        desk()
        with b.at(T(0.85, 0.1, 0.804)):
            candlestick(True)
        with b.at(T(-0.25, -0.1, 0.804) @ RZ(0.2)):
            open_book()
        pile(-0.85, 0.15, 4, 0.804)
        spot('keySpots', (0.35, 0.22, 0.806), "on the librarian's desk")
        spot('noteSpots', (-0.25, -0.1, 0.84), 'desk')
    with b.at(T(0.1, 17.5) @ RZ(math.pi + 0.3)):
        chair()
    for sx in (-1, 1):
        with b.at(T(sx * 2.5, 18.2)):
            candelabra(True, 4)
    with b.at(T(-2.9, 15.2)):
        globe()
    floor_books(1.8, 15.0, 9, 1.2, 1.0)

    # ---- reading tables down the nave
    tables = [(2.45, 8.0, True), (-2.45, 2.5, False), (2.45, -4.0, True), (-2.45, -10.0, False)]
    for i, (x, y, lit) in enumerate(tables):
        with b.at(T(x, y) @ RZ(math.pi / 2 + R.uniform(-0.04, 0.04))):
            table()
            if lit:
                with b.at(T(R.uniform(-0.5, 0.5), 0.1, 0.782)):
                    candlestick(True)
            else:
                with b.at(T(0.4, -0.1, 0.782)):
                    candlestick(False)
            with b.at(T(-0.7, 0.05, 0.782) @ RZ(R.uniform(-0.4, 0.4))):
                open_book()
            pile(0.85, -0.2, R.randint(2, 5), 0.782)
            for _ in range(3):
                with b.at(T(R.uniform(-1, 1), R.uniform(-0.3, 0.3), 0.783) @ RZ(R.uniform(0, TAU)) @ FLAT):
                    b.book_box(R.uniform(0.025, 0.05), R.uniform(0.2, 0.3), R.uniform(0.15, 0.2))
            spot('keySpots' if i % 2 == 0 else 'batterySpots', (-0.15, -0.28, 0.784), 'on a reading table in the nave')
            # chairs: some tucked in, some toppled
            for k, (cx, cy, ca) in enumerate(((-0.6, -0.85, 0), (0.6, -0.85, 0), (-0.6, 0.85, math.pi), (0.6, 0.85, math.pi))):
                r = R.random()
                if r < 0.25:
                    continue
                if r < 0.5:
                    with b.at(T(cx + R.uniform(-0.3, 0.3), cy * 1.5, 0.235) @ RZ(R.uniform(0, TAU)) @ RX(math.pi / 2)):
                        chair(False)
                else:
                    with b.at(T(cx, cy * R.uniform(1.0, 1.15), 0) @ RZ(ca + R.uniform(-0.4, 0.4))):
                        chair()
        floor_books(x, y, 6, 1.6, 2.0)

    for sx, y in ((-1, 12.5), (1, 12.5), (-1, -12.5), (1, -12.5), (1, -2.5)):
        with b.at(T(sx * 3.25, y)):
            candelabra(sx * y > 0 or y == -2.5, 3)
    for y in (-10.0, 1.0, 11.0):
        with b.at(T(0, y)):
            chandelier(7.4)
    with b.at(T(-1.9, -15.0) @ RZ(rad(200))):
        lectern()
        spot('batterySpots', (0.0, 0.4, 0.005), 'at the foot of a lectern')
    with b.at(T(1.6, 12.6) @ RZ(rad(170))):
        lectern()
    floor_books(0, -16.5, 14, 2.6, 1.6)
    floor_books(0, 0, 10, 1.4, 10)
    pile(2.9, -17.6, 9)
    pile(3.1, -17.2, 5)

    # ---- portraits on the nave piers
    for sx, y in PAINT:
        painting(Frame((sx * 3.65, y, 0), (0, 1, 0), (sx, 0, 0)))

    # ---- east aisle reading nook (y = 0)
    with b.at(T(8.3, 0.0) @ RZ(R.uniform(-0.05, 0.05))):
        table(2.0, 0.9)
        with b.at(T(0.5, 0, 0.782)):
            candlestick(True)
        pile(-0.6, 0.1, 3, 0.782)
        spot('keySpots', (0.0, -0.2, 0.784), 'on the table in the east reading nook')
        with b.at(T(-0.4, -0.8) @ RZ(0.2)):
            chair()
        with b.at(T(0.5, 1.1, 0.235) @ RZ(2.0) @ RX(math.pi / 2)):
            chair(False)
    floor_books(8.3, 0, 8, 1.8, 1.4)

    # ---- north-east archive corner: card catalogues, small table
    for x in (7.3, 8.72):
        with b.at(T(x + 1.4, 19.98) @ RZ(math.pi)):
            catalog()
    spot('keySpots', (8.0, 19.72, 1.292), 'on top of the card catalogue')
    with b.at(T(9.5, 19.75, 1.29)):
        candlestick(False)
    with b.at(T(7.4, 17.3)):
        candelabra(True, 3)
    pile(10.3, 17.2, 7)
    pile(10.6, 17.5, 4)
    floor_books(8.5, 17.6, 12, 2.0, 1.2)
    spot('batterySpots', (10.75, 17.0, 0.005), 'on the floor of the archive corner')

    # ---- west aisle study (stacks removed around y = -3.75)
    with b.at(T(-8.6, -3.75)):
        with b.at(T(0.9, 0.4)):
            globe()
        with b.at(T(-0.6, -0.3) @ RZ(0.5)):
            table(1.4, 0.8)
            with b.at(T(0.2, 0, 0.782)):
                candlestick(True)
            spot('keySpots', (-0.3, 0.1, 0.784), 'on the study table in the west aisle')
        with b.at(T(-0.3, 1.0) @ RZ(3.4)):
            chair()
        with b.at(T(1.5, -1.6) @ RZ(rad(-60))):
            lectern()
    floor_books(-8.4, -3.7, 10, 1.8, 2.4)

    # ---- south-west corner: junk, ladder, piles
    for i in range(4):
        pile(-10.8 + i * 0.45 + R.uniform(-0.1, 0.1), -18.3 + R.uniform(-0.3, 0.3), R.randint(4, 12))
    floor_books(-8.5, -17.6, 14, 2.4, 1.3)
    spot('keySpots', (-10.4, -17.55, 0.005), 'behind the book piles in the south-west corner')
    with b.at(T(-6.9, -17.2)):
        candelabra(False, 3)

    # ---- spilled books around the toppled stack
    floor_books(-5.6, 10.8, 26, 0.9, 2.2)
    floor_books(-8.4, 9.2, 16, 1.8, 0.35)
    spot('keySpots', (-5.2, 11.6, 0.005), 'among the books spilled from the toppled stack')
    spot('batterySpots', (-6.1, 8.9, 0.005), 'by the toppled stack')

    # ---- ladders leaning on stacks
    for x, y, a in ((8.0, 3.93, 0), (-8.9, -11.05, 0), (9.2, -16.05, 0), (-7.4, 16.05, math.pi), (10.92, 10.9, -math.pi / 2), (-10.92, -9.3, math.pi / 2)):
        with b.at(T(x, y, 0) @ RZ(a) @ RX(-rad(13))):
            ladder()
    with b.at(T(1.2, -8.6, 0.03) @ RZ(0.7) @ RX(-math.pi / 2)):     # one lying in the nave
        ladder(2.6)

    # ---- hiding cabinets
    idx = 0
    for y in HIDE_E:
        hide_cabinet(T(11.97, y) @ RZ(math.pi / 2), idx); idx += 1
    for y in HIDE_W:
        hide_cabinet(T(-11.97, y) @ RZ(-math.pi / 2), idx); idx += 1
    hide_cabinet(T(-8.0, -19.97), idx)

    # ---- cobwebs in corners (pier/fascia, stack tops)
    for y in PIERS[1:-1]:
        for sx in (-1, 1):
            s = R.uniform(0.45, 0.8)
            cobweb((sx * 3.72, y + 0.36, 3.85), (0, s, 0), (0, 0, -s))
            if R.random() < 0.6:
                cobweb((sx * 3.72, y - 0.36, 3.85), (0, -s, 0), (0, 0, -s * 0.8))
    for y in STACK_Y:
        for sx in (-1, 1):
            if R.random() < 0.55:
                s = R.uniform(0.4, 0.75)
                cobweb((sx * 6.38, y + 0.33, ZB - 0.2), (0, s * 0.9, 0), (0, 0, -s))
            if R.random() < 0.4:
                cobweb((sx * 10.25, y - 0.34, 3.0), (sx * 0.6, 0, 0), (0, 0, -0.6))


shell()
shelves()
furnish()
exit_doors()
pickups()

static = b.to_object('Library', MATS)
print('static mesh: %d faces, %d verts' % (len(b.f), len(b.v)))
for name, d, M in OBJECTS:
    ob = d.to_object(name, MATS)
    ob.matrix_world = M


# =================================================================== metadata
def g(p):  # blender -> game coordinates
    return [round(p[0], 3), round(p[2], 3), round(-p[1], 3)]


level = {
    'bounds': {'minX': -AX, 'maxX': AX, 'minZ': -LY, 'maxZ': LY + 4.6},
    'colliders': [{'min': [round(mn[0], 3), round(mn[2], 3), round(-mx[1], 3)],
                   'max': [round(mx[0], 3), round(mx[2], 3), round(-mn[1], 3)], **({'tag': tag} if tag else {})}
                  for mn, mx, tag in b.colliders],
    'candles': [{'pos': g(c['pos']), 'flames': [g(f) for f in c['flames']], 'lit': c['lit'], 'kind': c['kind']} for c in A['candles']],
    'keySpots': [{'pos': g(s['pos']), 'hint': s['hint']} for s in A['keySpots']],
    'batterySpots': [{'pos': g(s['pos']), 'hint': s['hint']} for s in A['batterySpots']],
    'noteSpots': [{'pos': g(s['pos'])} for s in A['noteSpots']],
    'hides': [{'id': h['id'], 'pos': g(h['pos']), 'front': g(h['front'])} for h in A['hides']],
    'gallery': [{'pos': g(s['pos'])} for s in A['gallery']],
    'playerSpawn': g((0, 13.6, 0)),
    'ghostSpawn': g((0, -13, 0)),
    'exit': {'door': g((0, -LY, 0)), 'win': g((0, -LY - 2.2, 0))},
    'window': g((0, LY, 6.5)),
}
with open(OUT + '/level.json', 'w') as f:
    json.dump(level, f, separators=(',', ':'))
print({k: len(v) for k, v in level.items() if isinstance(v, list) and k not in ('playerSpawn', 'ghostSpawn', 'window')})

bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=HERE + '/out/library.blend')
bpy.ops.export_scene.gltf(filepath=HERE + '/out/library_raw.glb', export_format='GLB', export_yup=True, export_apply=False,
                          export_image_format='AUTO', export_normals=True, export_tangents=False, export_materials='EXPORT',
                          export_cameras=False, export_lights=False, export_animations=False)
print('exported', os.path.getsize(HERE + '/out/library_raw.glb') // 1024, 'kB')
