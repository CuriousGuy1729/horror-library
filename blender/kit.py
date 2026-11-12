"""Tiny procedural modelling kit used by build_library.py.

Everything is accumulated into flat python lists (verts / faces / uvs / custom normals / material ids)
and turned into a single Blender mesh at the end, which keeps the exported map down to one draw call
per material.
"""
import math
import random
from contextlib import contextmanager

import bpy
from mathutils import Matrix, Vector

R = random.Random(1729)
TAU = math.tau


def T(x, y, z=0.0):
    return Matrix.Translation((x, y, z))


def RZ(a):
    return Matrix.Rotation(a, 4, 'Z')


def RX(a):
    return Matrix.Rotation(a, 4, 'X')


def RY(a):
    return Matrix.Rotation(a, 4, 'Y')


def pointed(span, rise, n=8):
    """Two-centred gothic arch, as (s, z) points from the left springing to the right one."""
    c = (rise * rise - span * span / 4) / span
    rad = c + span / 2
    a1 = math.atan2(rise, -c)
    left = []
    for i in range(n + 1):
        a = math.pi + (a1 - math.pi) * i / n
        left.append((c + rad * math.cos(a), rad * math.sin(a)))
    left[-1] = (0.0, rise)
    return left + [(-s, z) for s, z in reversed(left[:-1])]


def circle(r, n=24, start=math.pi, sweep=-TAU):
    """Clockwise circle (left -> top -> right -> bottom) so outward normals match `pointed`."""
    return [(r * math.cos(start + sweep * i / n), r * math.sin(start + sweep * i / n)) for i in range(n)]


def shift(pts, ds, dz):
    return [(s + ds, z + dz) for s, z in pts]


def path_normals(pts, closed=False):
    """Outward (left of travel) mitred normals of a 2D polyline."""
    n = len(pts)
    segn = []
    for i in range(n if closed else n - 1):
        (s0, z0), (s1, z1) = pts[i], pts[(i + 1) % n]
        l = math.hypot(s1 - s0, z1 - z0) or 1.0
        segn.append((-(z1 - z0) / l, (s1 - s0) / l))
    out = []
    for i in range(n):
        if closed:
            a, b = segn[i - 1], segn[i]
        else:
            a, b = segn[max(i - 1, 0)], segn[min(i, n - 2)]
        mx, mz = a[0] + b[0], a[1] + b[1]
        l = math.hypot(mx, mz) or 1.0
        mx, mz = mx / l, mz / l
        k = 1.0 / max(0.5, mx * a[0] + mz * a[1])
        out.append((mx * k, mz * k))
    return out


class Frame:
    """A vertical working plane: s runs horizontally, z is up, d is depth."""

    def __init__(self, origin, sdir, ddir):
        self.o, self.sd, self.dd = origin, sdir, ddir

    def p(self, s, z, d=0.0):
        o, sd, dd = self.o, self.sd, self.dd
        return (o[0] + sd[0] * s + dd[0] * d, o[1] + sd[1] * s + dd[1] * d, o[2] + z)

    def v(self, ns, nz, nd=0.0):
        sd, dd = self.sd, self.dd
        return (sd[0] * ns + dd[0] * nd, sd[1] * ns + dd[1] * nd, nz)


class Builder:
    def __init__(self):
        self.v, self.f, self.uv, self.nr, self.fm = [], [], [], [], []
        self.names = []
        self.M = None
        self.N = None
        self.colliders = []

    # ------------------------------------------------------------------ core
    def mat(self, name):
        if name not in self.names:
            self.names.append(name)
        return self.names.index(name)

    @contextmanager
    def at(self, M):
        old = self.M
        self.M = M if old is None else old @ M
        self.N = self.M.to_3x3()
        try:
            yield
        finally:
            self.M = old
            self.N = old.to_3x3() if old is not None else None

    def world(self, p):
        return tuple(self.M @ Vector(p)) if self.M is not None else tuple(p)

    def poly(self, pts, uvs, m, facing=None, normals=None):
        if self.M is not None:
            pts = [tuple(self.M @ Vector(p)) for p in pts]
            if facing is not None:
                facing = tuple(self.N @ Vector(facing))
            if normals is not None:
                normals = [tuple(self.N @ Vector(n)) for n in normals]
        nx = ny = nz = 0.0
        k = len(pts)
        for i in range(k):  # Newell
            a, b = pts[i], pts[(i + 1) % k]
            nx += (a[1] - b[1]) * (a[2] + b[2])
            ny += (a[2] - b[2]) * (a[0] + b[0])
            nz += (a[0] - b[0]) * (a[1] + b[1])
        l = math.sqrt(nx * nx + ny * ny + nz * nz)
        if l < 1e-12:
            return
        nx, ny, nz = nx / l, ny / l, nz / l
        if facing is None and normals is not None:
            facing = normals[0]
        if facing is not None and nx * facing[0] + ny * facing[1] + nz * facing[2] < 0:
            pts, uvs = pts[::-1], uvs[::-1]
            if normals is not None:
                normals = normals[::-1]
            nx, ny, nz = -nx, -ny, -nz
        base = len(self.v)
        self.v.extend(pts)
        self.f.append(tuple(range(base, base + k)))
        self.uv.extend(uvs)
        self.nr.extend(normals if normals is not None else [(nx, ny, nz)] * k)
        self.fm.append(self.mat(m))

    def col(self, mn, mx, tag=None):
        """Register an axis aligned collider (given in the current local frame)."""
        if self.M is not None:
            cs = [self.M @ Vector((x, y, z)) for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]
            mn = tuple(min(c[i] for c in cs) for i in range(3))
            mx = tuple(max(c[i] for c in cs) for i in range(3))
        self.colliders.append((tuple(mn), tuple(mx), tag))

    # ------------------------------------------------------------ primitives
    def box(self, mn, mx, m, ts=1.2, grain=None, skip='', uvoff=None):
        ou, ov = (R.random(), R.random()) if uvoff is None else uvoff
        for a in range(3):
            b, c = (a + 1) % 3, (a + 2) % 3
            if grain in (b, c):
                va = grain
            elif grain is None and 2 in (b, c):
                va = 2
            else:
                va = c
            ua = b if va == c else c
            for sign in (0, 1):
                if 'xyz'[a] + '-+'[sign] in skip:
                    continue
                pts, uvs = [], []
                for pb, pc in ((mn[b], mn[c]), (mx[b], mn[c]), (mx[b], mx[c]), (mn[b], mx[c])):
                    p = [0.0, 0.0, 0.0]
                    p[a] = mx[a] if sign else mn[a]
                    p[b], p[c] = pb, pc
                    pts.append(tuple(p))
                    uvs.append((p[ua] / ts + ou, p[va] / ts + ov))
                f = [0, 0, 0]
                f[a] = 1 if sign else -1
                self.poly(pts, uvs, m, facing=f)

    def quad(self, p0, du, dv, m, ts=1.0, facing=None, uv=None):
        """Planar quad p0, p0+du, p0+du+dv, p0+dv. uv=None -> metric uv, else (u0,v0,u1,v1)."""
        pts = [p0, tuple(p0[i] + du[i] for i in range(3)), tuple(p0[i] + du[i] + dv[i] for i in range(3)),
               tuple(p0[i] + dv[i] for i in range(3))]
        if uv is None:
            lu = math.sqrt(sum(x * x for x in du))
            lv = math.sqrt(sum(x * x for x in dv))
            u0 = sum(p0[i] * du[i] for i in range(3)) / (lu or 1) / ts
            v0 = sum(p0[i] * dv[i] for i in range(3)) / (lv or 1) / ts
            uvs = [(u0, v0), (u0 + lu / ts, v0), (u0 + lu / ts, v0 + lv / ts), (u0, v0 + lv / ts)]
        else:
            u0, v0, u1, v1 = uv
            uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        self.poly(pts, uvs, m, facing=facing)

    def lathe(self, c, prof, m, n=10, ts=1.0):
        cx, cy, cz = c
        rmax = max(r for r, _ in prof)
        for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
            dr, dz = r1 - r0, z1 - z0
            l = math.hypot(dr, dz) or 1.0
            nr, nz = dz / l, -dr / l
            for i in range(n):
                a0, a1 = TAU * i / n, TAU * (i + 1) / n
                c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
                pts = [(cx + r0 * c0, cy + r0 * s0, cz + z0), (cx + r0 * c1, cy + r0 * s1, cz + z0),
                       (cx + r1 * c1, cy + r1 * s1, cz + z1), (cx + r1 * c0, cy + r1 * s0, cz + z1)]
                nrm = [(nr * c0, nr * s0, nz), (nr * c1, nr * s1, nz), (nr * c1, nr * s1, nz), (nr * c0, nr * s0, nz)]
                u0, u1 = i / n * TAU * rmax / ts, (i + 1) / n * TAU * rmax / ts
                uvs = [(u0, z0 / ts), (u1, z0 / ts), (u1, z1 / ts), (u0, z1 / ts)]
                mid = ((nrm[0][0] + nrm[1][0]) / 2, (nrm[0][1] + nrm[1][1]) / 2, nz)
                self.poly(pts, uvs, m, facing=mid, normals=nrm)

    def tube(self, pts, r, m, n=6, ts=1.0, closed=False):
        k = len(pts)
        for i in range(k if closed else k - 1):
            a, b = Vector(pts[i]), Vector(pts[(i + 1) % k])
            d = (b - a)
            if d.length < 1e-9:
                continue
            d.normalize()
            u = d.cross(Vector((0, 0, 1)))
            if u.length < 1e-4:
                u = d.cross(Vector((1, 0, 0)))
            u.normalize()
            w = d.cross(u)
            for j in range(n):
                a0, a1 = TAU * j / n, TAU * (j + 1) / n
                n0 = u * math.cos(a0) + w * math.sin(a0)
                n1 = u * math.cos(a1) + w * math.sin(a1)
                ps = [tuple(a + n0 * r), tuple(a + n1 * r), tuple(b + n1 * r), tuple(b + n0 * r)]
                self.poly(ps, [(0, 0), (0.1, 0), (0.1, 0.3), (0, 0.3)], m, facing=tuple((n0 + n1) / 2),
                          normals=[tuple(n0), tuple(n1), tuple(n1), tuple(n0)])

    def sphere(self, c, r, m, n=16, uvrect=(0, 0, 1, 1)):
        for i in range(n // 2):
            t0, t1 = math.pi * i / (n // 2), math.pi * (i + 1) / (n // 2)
            for j in range(n):
                a0, a1 = TAU * j / n, TAU * (j + 1) / n
                def P(t, a):
                    return (math.sin(t) * math.cos(a), math.sin(t) * math.sin(a), math.cos(t))
                ns = [P(t1, a0), P(t1, a1), P(t0, a1), P(t0, a0)]
                pts = [(c[0] + q[0] * r, c[1] + q[1] * r, c[2] + q[2] * r) for q in ns]
                u0, v0, u1, v1 = uvrect
                def UV(t, a):
                    return (u0 + (u1 - u0) * a / TAU, v0 + (v1 - v0) * (1 - t / math.pi))
                uvs = [UV(t1, a0), UV(t1, a1), UV(t0, a1), UV(t0, a0)]
                self.poly(pts, uvs, m, facing=P((t0 + t1) / 2, (a0 + a1) / 2), normals=ns)

    # ----------------------------------------------------------- arch pieces
    def band(self, fr, pts, t, d0, d1, m, ts=1.5, closed=False, faces='fbio'):
        """Sweep a rectangular section (thickness t outward, depth d0..d1) along a 2D path."""
        nrm = path_normals(pts, closed)
        a = pts
        b = [(p[0] + n[0] * t, p[1] + n[1] * t) for p, n in zip(pts, nrm)]
        k = len(pts)
        sg = 1 if t > 0 else -1
        acc = 0.0
        for i in range(k if closed else k - 1):
            j = (i + 1) % k
            seg = math.hypot(a[j][0] - a[i][0], a[j][1] - a[i][1])
            u0, u1 = acc / ts, (acc + seg) / ts
            acc += seg
            n3 = fr.v((nrm[i][0] + nrm[j][0]) / 2 * sg, (nrm[i][1] + nrm[j][1]) / 2 * sg)
            neg = (-n3[0], -n3[1], -n3[2])
            tv = abs(t) / ts
            if 'f' in faces:
                self.poly([fr.p(*a[i], d0), fr.p(*a[j], d0), fr.p(*b[j], d0), fr.p(*b[i], d0)],
                          [(u0, 0), (u1, 0), (u1, tv), (u0, tv)], m, facing=fr.v(0, 0, -1 if d0 < d1 else 1))
            if 'b' in faces:
                self.poly([fr.p(*a[i], d1), fr.p(*a[j], d1), fr.p(*b[j], d1), fr.p(*b[i], d1)],
                          [(u0, 0), (u1, 0), (u1, tv), (u0, tv)], m, facing=fr.v(0, 0, 1 if d0 < d1 else -1))
            dv = abs(d1 - d0) / ts
            if 'i' in faces:
                self.poly([fr.p(*a[i], d0), fr.p(*a[j], d0), fr.p(*a[j], d1), fr.p(*a[i], d1)],
                          [(u0, 0), (u1, 0), (u1, dv), (u0, dv)], m, facing=neg)
            if 'o' in faces:
                self.poly([fr.p(*b[i], d0), fr.p(*b[j], d0), fr.p(*b[j], d1), fr.p(*b[i], d1)],
                          [(u0, 0), (u1, 0), (u1, dv), (u0, dv)], m, facing=n3)

    def arch_wall(self, fr, s0, s1, z0, z1, ops, m, ts=2.2, d=0.0, facing=None):
        """Flat wall s0..s1 x z0..z1 with openings. ops = [(upper_pts, lower_pts|None)], sorted by s."""
        def q(p2):
            self.poly([fr.p(s, z, d) for s, z in p2], [(s / ts, z / ts) for s, z in p2], m, facing=facing)
        cur = s0
        for upper, lower in ops:
            sa, sb = upper[0][0], upper[-1][0]
            if sa - cur > 1e-6:
                q([(cur, z0), (sa, z0), (sa, z1), (cur, z1)])
            for (a0, b0), (a1, b1) in zip(upper, upper[1:]):
                if a1 - a0 > 1e-6:
                    q([(a0, b0), (a1, b1), (a1, z1), (a0, z1)])
            if lower:
                for (a0, b0), (a1, b1) in zip(lower, lower[1:]):
                    if a1 - a0 > 1e-6:
                        q([(a0, z0), (a1, z0), (a1, b1), (a0, b0)])
            cur = sb
        if s1 - cur > 1e-6:
            q([(cur, z0), (s1, z0), (s1, z1), (cur, z1)])

    # ------------------------------------------------------------------ books
    @staticmethod
    def _cell(k):
        return (k + 0.07) / 32, (k + 0.93) / 32

    def book_box(self, w, h, dep, k=None):
        """Free-standing closed book. local: thickness x 0..w, depth y 0..dep (spine at y=dep), height z 0..h."""
        k = R.randrange(32) if k is None else k
        u0, u1 = self._cell(k)
        m = 'books'
        self.poly([(0, dep, 0), (w, dep, 0), (w, dep, h), (0, dep, h)], [(u0, .254), (u1, .254), (u1, .998), (u0, .998)], m, facing=(0, 1, 0))
        self.poly([(0, 0, 0), (w, 0, 0), (w, 0, h), (0, 0, h)], [(u0, .006), (u1, .006), (u1, .118), (u0, .118)], m, facing=(0, -1, 0))
        for z, f in ((0, -1), (h, 1)):
            self.poly([(0, 0, z), (w, 0, z), (w, dep, z), (0, dep, z)], [(u0, .006), (u0, .118), (u1, .118), (u1, .006)], m, facing=(0, 0, f))
        for x, f in ((0, -1), (w, 1)):
            self.poly([(x, 0, 0), (x, dep, 0), (x, dep, h), (x, 0, h)], [(u0, .132), (u1, .132), (u1, .244), (u0, .244)], m, facing=(f, 0, 0))

    def book_row(self, o, al, out, length, clear, depth, fill=0.94, top=True):
        """A shelf row of upright books. o = back-left-bottom corner, al = along, out = towards the reader."""
        books, a = [], 0.004
        run = 0
        while a < length - 0.025:
            if R.random() > fill and run == 0:
                g = R.uniform(0.04, 0.35)
                if g > 0.2 and a + g < length and R.random() < 0.6:      # a few books lying flat in the gap
                    z = 0.0
                    for _ in range(R.randint(1, 4)):
                        w, h, dp = R.uniform(0.025, 0.05), min(g - 0.02, R.uniform(0.2, 0.3)), R.uniform(0.14, 0.19)
                        oo = depth - dp - 0.01
                        M = Matrix(((al[0], out[0], 0, o[0] + al[0] * (a + 0.01) + out[0] * oo),
                                    (al[1], out[1], 0, o[1] + al[1] * (a + 0.01) + out[1] * oo),
                                    (0, 0, 1, o[2] + z), (0, 0, 0, 1)))
                        # lying flat: thickness -> up, depth -> out (spine towards the reader), height -> along
                        with self.at(M @ Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))):
                            self.book_box(w, h, dp)
                        z += w
                a += g
                continue
            if run == 0 and R.random() < 0.22:
                run = R.randint(3, 8)
                rk, rw, rh, rd = R.randrange(32), R.uniform(0.03, 0.06), min(clear - 0.02, R.uniform(0.24, 0.34)), R.uniform(0.16, 0.2)
            if run > 0:
                run -= 1
                k, w, h, dp, sp = rk, rw, rh, rd, depth - 0.012
            else:
                k, w = R.randrange(32), R.uniform(0.02, 0.058)
                h, dp, sp = min(clear - 0.02, R.uniform(0.18, 0.33)), R.uniform(0.13, 0.2), depth - R.uniform(0.004, 0.045)
            if a + w > length:
                break
            books.append((a, w, h, dp, sp, k))
            a += w + 0.0012

        def P(a_, o_, z_):
            return (o[0] + al[0] * a_ + out[0] * o_, o[1] + al[1] * a_ + out[1] * o_, o[2] + z_)

        nal = (-al[0], -al[1], 0)
        for i, (a, w, h, dp, sp, k) in enumerate(books):
            u0, u1 = self._cell(k)
            self.poly([P(a, sp, 0), P(a + w, sp, 0), P(a + w, sp, h), P(a, sp, h)],
                      [(u0, .254), (u1, .254), (u1, .998), (u0, .998)], 'books', facing=out)
            if top:
                self.poly([P(a, sp - dp, h), P(a + w, sp - dp, h), P(a + w, sp, h), P(a, sp, h)],
                          [(u0, .006), (u1, .006), (u1, .118), (u0, .118)], 'books', facing=(0, 0, 1))
            for side, nb, x, f in ((0, books[i - 1] if i else None, a, nal), (1, books[i + 1] if i + 1 < len(books) else None, a + w, al)):
                vis = nb is None or nb[2] < h - 0.004 or nb[4] < sp - 0.004
                if not vis:
                    gap = (a - (nb[0] + nb[1])) if side == 0 else (nb[0] - (a + w))
                    vis = gap > 0.004
                if vis:
                    self.poly([P(x, sp - dp, 0), P(x, sp, 0), P(x, sp, h), P(x, sp - dp, h)],
                              [(u0, .132), (u1, .132), (u1, .244), (u0, .244)], 'books', facing=f)
        return len(books)

    # ------------------------------------------------------------------ output
    def to_object(self, name, materials, collection=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        uvl = me.uv_layers.new(name='UVMap')
        flat = [c for uv in self.uv for c in uv]
        uvl.data.foreach_set('uv', flat)
        for n in self.names:
            me.materials.append(materials[n])
        me.polygons.foreach_set('material_index', self.fm)
        me.polygons.foreach_set('use_smooth', [True] * len(self.f))
        me.normals_split_custom_set(self.nr)
        me.update()
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        return ob
