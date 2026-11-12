"""Cycles renders of the map.   python3 blender/render_preview.py [view ...] [--draft] [--work]
Views are defined in VIEWS below; output goes to blender/out/<view>.png
"""
import json, math, os, sys
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.open_mainfile(filepath=HERE + '/out/library.blend')
level = json.load(open(HERE + '/../public/assets/level.json'))
sc = bpy.context.scene
args = [a for a in sys.argv[1:] if not a.startswith('--')]
draft, work = '--draft' in sys.argv, '--work' in sys.argv

VIEWS = {  # name: (eye, target, lens)
    'nave_north': ((0.6, -9, 1.7), (0, 20, 5.2), 20),
    'nave_south': ((-0.8, 13, 1.7), (0, -20, 3.5), 20),
    'aisle_east': ((5.3, -6.2, 1.65), (5.6, 14, 1.5), 22),
    'stacks': ((7.2, 6.1, 1.6), (11.5, 6.4, 1.3), 18),
    'gallery': ((-2.5, -4, 1.7), (9, 6, 5.5), 18),
    'fallen': ((-4.9, 7.2, 1.6), (-9, 11.5, 1.2), 20),
    'desk': ((1.8, 12.2, 1.6), (-0.5, 19, 2.2), 22),
    'top': ((0, 0, 60), (0, 0.01, 0), 40),
}

def g2b(p):
    return (p[0], -p[2], p[1])

w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.6, 0.6, 1) if work else (0.0, 0.0, 0.0, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0 if work else 0.0
head = None
if work:
    hl = bpy.data.lights.new('head', 'POINT'); hl.energy = 1500; hl.shadow_soft_size = 0.3
    head = bpy.data.objects.new('head', hl); sc.collection.objects.link(head)
    for y in range(-16, 17, 8):
        for x in (-8, 0, 8):
            l = bpy.data.lights.new('wl', 'POINT'); l.energy = 1200 if x == 0 else 500; l.shadow_soft_size = 0.5
            o = bpy.data.objects.new('wl', l); o.location = (x, y, 6.5 if x == 0 else 3.2); sc.collection.objects.link(o)
if not work:
    moon = bpy.data.lights.new('moon', 'SUN'); moon.energy = 6.0; moon.color = (0.55, 0.68, 1.0); moon.angle = math.radians(2)
    mo = bpy.data.objects.new('moon', moon); sc.collection.objects.link(mo)
    d = Vector((0.12, -1, -0.62)); mo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    for c in level['candles']:
        if not c['lit']:
            continue
        for f in c['flames']:
            l = bpy.data.lights.new('c', 'POINT'); l.energy = 2.2 if c['kind'] != 'chandelier' else 3.0
            l.color = (1.0, 0.5, 0.16); l.shadow_soft_size = 0.02
            o = bpy.data.objects.new('c', l); o.location = g2b(f); sc.collection.objects.link(o)
    # faint fill so the vault is not pure black
    fill = bpy.data.lights.new('fill', 'AREA'); fill.energy = 250; fill.size = 8; fill.color = (0.4, 0.5, 0.8)
    fo = bpy.data.objects.new('fill', fill); fo.location = (0, 12, 11.5); sc.collection.objects.link(fo)
    if 'top' in args:
        w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
        w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.5, 0.5, 1)

sc.render.engine = 'CYCLES'
sc.cycles.samples = 16 if draft else 72
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 2 if draft else 5
sc.render.resolution_x, sc.render.resolution_y = (640, 360) if draft else (1280, 720)
sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [i.identifier for i in type(sc.view_settings).bl_rna.properties['view_transform'].enum_items] else 'AgX'
sc.view_settings.exposure = 0.0 if work else 1.6
cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
cam.clip_start = 0.05
for name in args or VIEWS:
    eye, tgt, lens = VIEWS[name]
    co.location = eye
    if head: head.location = (eye[0], eye[1], eye[2] + 0.3)
    co.rotation_euler = (Vector(tgt) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    cam.lens = lens
    if name == 'top':
        for o in bpy.data.objects:   # hide vault/ceilings is not possible on a joined mesh: use clipping instead
            pass
        cam.type = 'ORTHO'; cam.ortho_scale = 46; cam.clip_start = 56.2; sc.render.resolution_x, sc.render.resolution_y = 600, 1000
    else:
        cam.type = 'PERSP'
    sc.render.filepath = f'{HERE}/out/{name}.png'
    bpy.ops.render.render(write_still=True)
    print('rendered', name)
