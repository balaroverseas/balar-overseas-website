"""Cycles render of the port phase (reach stacker, stack, truck) from the live scene's export.

The page exports its scene (js/dev/export-journey.js): _export/journey.glb holds the geometry,
_export/journey_anim.json the camera and every moving node per frame, journey_hidden.json what is
switched off at the start. Here it is lit like the page (white surround, high sun) but path traced:
soft contact shadows, bounce light, bevelled edges, so the machine reads like the reference's render.

  blender -b --factory-startup -P journey_render.py -- --frames 1-240 --samples 64
"""
import sys
import os
import json
import math
import argparse
import bpy
from mathutils import Matrix, Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--frames', default='1')
ap.add_argument('--samples', type=int, default=64)
ap.add_argument('--res', default='1280x720')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'seq', 'port'))
args = ap.parse_args(argv)
rx, ry = map(int, args.res.split('x'))
ROOT = os.path.join(os.path.dirname(__file__), '..', '_export')

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.abspath(os.path.join(ROOT, 'journey.glb')))
for o in [o for o in sc.objects if o.type in ('LIGHT', 'CAMERA')]:
    bpy.data.objects.remove(o)
anim = json.load(open(os.path.join(ROOT, 'journey_anim.json')))
hidden = set(json.load(open(os.path.join(ROOT, 'journey_hidden.json'))))
objs = {o.name: o for o in sc.objects}


def hide_tree(o, h):
    o.hide_render = h
    for c in o.children:
        if c.name not in hidden:
            hide_tree(c, h)


for n in hidden:
    if n in objs:
        o = objs[n]
        o.hide_render = True
        for c in o.children_recursive:
            c.hide_render = True

# ---------------------------------------------------------------- materials: a touch of realism
# bevelled edges on the plain painted parts (catch the light like the reference); paint that is not
# a texture gets a faint large-scale mottle in colour and roughness (wear, dust), never a pattern
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    if not b:
        continue
    if not b.inputs['Normal'].is_linked:
        bev = nt.nodes.new('ShaderNodeBevel')
        bev.inputs['Radius'].default_value = 0.02
        bev.samples = 6
        nt.links.new(bev.outputs['Normal'], b.inputs['Normal'])
    if not b.inputs['Base Color'].is_linked:
        col = tuple(b.inputs['Base Color'].default_value)
        tc = nt.nodes.new('ShaderNodeTexCoord')
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 1.6
        nz.inputs['Detail'].default_value = 6
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[1].position = 0.75
        ramp.color_ramp.elements[0].color = (col[0] * 0.86, col[1] * 0.86, col[2] * 0.85, 1)
        ramp.color_ramp.elements[1].color = col
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
        if not b.inputs['Roughness'].is_linked:
            r0 = b.inputs['Roughness'].default_value
            mr = nt.nodes.new('ShaderNodeMapRange')
            mr.inputs['To Min'].default_value = max(0.05, r0 - 0.08)
            mr.inputs['To Max'].default_value = min(1.0, r0 + 0.12)
            nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
            nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])

# ---------------------------------------------------------------- animation (three.js Y-up → Blender Z-up)
F = anim['frames']
sc.frame_start, sc.frame_end = 1, F
names = anim['nodes']
movers = [objs.get(n) for n in names]
for o in movers:
    if o:
        o.rotation_mode = 'QUATERNION'
for f in range(F):
    row = anim['data'][f]
    for o, v in zip(movers, row):
        if not o:
            continue
        px, py, pz, qx, qy, qz, qw, sx, sy, sz, vis = v
        o.location = (px, -pz, py)
        o.rotation_quaternion = Quaternion((qw, qx, -qz, qy))
        o.scale = (sx, sz, sy)
        o.keyframe_insert('location', frame=f + 1)
        o.keyframe_insert('rotation_quaternion', frame=f + 1)
        o.keyframe_insert('scale', frame=f + 1)
        o.hide_render = not vis
        o.keyframe_insert('hide_render', frame=f + 1)
# children of switched-off movers inherit nothing in Blender: hide them with the parent
for i, o in enumerate(movers):
    if not o:
        continue
    vis = [anim['data'][f][i][10] for f in range(F)]
    if all(vis):
        continue
    kids = [c for c in o.children_recursive if c.name not in hidden and c not in movers]
    for f in range(F):
        if f and vis[f] == vis[f - 1]:
            continue
        for c in kids:
            c.hide_render = not vis[f]
            c.keyframe_insert('hide_render', frame=f + 1)

# camera
cd = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.sensor_fit = 'VERTICAL'
cam.rotation_mode = 'QUATERNION'
C = Matrix.Rotation(math.pi / 2, 4, 'X')
for f, c in enumerate(anim['cam']):
    e = c['m']
    M = Matrix([[e[0], e[4], e[8], e[12]], [e[1], e[5], e[9], e[13]], [e[2], e[6], e[10], e[14]], [0, 0, 0, 1]])
    W = C @ M
    loc, rot, _ = W.decompose()
    cam.location = loc
    cam.rotation_quaternion = rot
    cd.angle_y = math.radians(c['fov'])
    cd.clip_start, cd.clip_end = max(0.05, c['near']), c['far']
    cam.keyframe_insert('location', frame=f + 1)
    cam.keyframe_insert('rotation_quaternion', frame=f + 1)
    cd.keyframe_insert('lens', frame=f + 1)

# ---------------------------------------------------------------- light: white surround + high sun
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
wn = w.node_tree
bg = wn.nodes['Background']
# real outdoor light (Blender's bundled "courtyard" HDRI: free, ships with Blender) for natural
# reflections and soft fill; the film is transparent so the page white stays the backdrop
env = wn.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(os.path.dirname(bpy.app.binary_path), '5.2', 'datafiles', 'studiolights', 'world', 'courtyard.exr'))
wn.links.new(env.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.1
sd = bpy.data.lights.new('sun', 'SUN')
sd.energy = 2.6
sd.angle = math.radians(3)
sun = bpy.data.objects.new('sun', sd)
sc.collection.objects.link(sun)
d = Vector((14, -24, 40)).normalized()                     # page: SUN_OFFSET (14, 40, 24)
sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
# ground: catches shadows only, composited over the page white
bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, -0.01))
gp = bpy.context.object
gp.is_shadow_catcher = True

# ---------------------------------------------------------------- render
sc.render.engine = 'CYCLES'
cyc = sc.cycles
cyc.device = 'CPU'                 # the machine's CUDA card (sm_60) has no Cycles kernels in 5.2
cyc.samples = args.samples
cyc.use_denoising = True
cyc.max_bounces = 6
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y = rx, ry
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'WEBP'
sc.render.image_settings.quality = 88
sc.render.image_settings.color_mode = 'RGBA'     # transparent with the shadows in alpha: the page white shows through

os.makedirs(args.out, exist_ok=True)
if '-' in args.frames:
    a, b = map(int, args.frames.split('-'))
    frames = range(a, b + 1)
else:
    frames = [int(x) for x in args.frames.split(',')]
for f in frames:
    sc.frame_set(f)
    sc.render.filepath = os.path.join(args.out, f'f{f:03d}.webp')
    bpy.ops.render.render(write_still=True)
print('DEVICE', cyc.device)
