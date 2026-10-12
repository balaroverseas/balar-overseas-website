"""The jet over the testimonials: one square, transparent, straight-down still of the scanned
heavy freighter (Meshy, from our own measured plan drawing), nose to the right. The scan smeared
the cockpit glazing, so the six panes are redrawn, and the titles are set as clean lettering.

  blender -b -P plane_meshy.py -- --res 1280 --samples 24 --out seq/_tplane
  blender -b -P plane_meshy.py -- --res 2560 --samples 64
"""
import sys
import os
import math
import argparse
import bpy
import bmesh

sys.path.append(os.path.dirname(__file__))
import lib  # noqa: E402
from lib import mat  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--res', type=int, default=2560)
ap.add_argument('--samples', type=int, default=64)
ap.add_argument('--bare', action='store_true')      # dev: the scan alone, no glazing or titles
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'seq', 'plane'))
args = ap.parse_args(argv)

s = lib.reset(samples=args.samples, res=(args.res, args.res), transparent=True)
s.view_settings.view_transform = 'Standard'
s.view_settings.look = 'None'
s.view_settings.exposure = EXPOSURE = -0.3
DOME, SUN = 1.08, 1.5
WARM = (1.0, 0.955, 0.86, 1)                   # the reference's white leans warm; the scan's paint leans blue
NOSE_WHITE = (0.70, 0.71, 0.725, 1)        # what the airframe paint around the glazing reads in the scan
EDGE_T, EDGE_K, EDGE_GREY = 0.55, 0.92, (0.69, 0.70, 0.72, 1)
s.render.image_settings.color_mode = 'RGBA'

# ----------------------------------------------------------------------------- the scan
# model: length along x (nose at -x, 1.85 long), span along y (1.90), fin up +z
path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '_export', 'meshy_plane_v1.glb'))
bpy.ops.import_scene.gltf(filepath=path)
jet = next(o for o in bpy.data.objects if o.type == 'MESH')
jet.rotation_mode = 'XYZ'
jet.rotation_euler = (0, 0, math.pi)                 # nose to the right of the picture
nt = jet.data.materials[0].node_tree
b = nt.nodes['Principled BSDF']
for name, val in (('Metallic', 0.0), ('Roughness', 0.45)):   # painted airframe, not chrome
    sock = b.inputs[name]
    if sock.is_linked:
        nt.links.remove(sock.links[0])
    sock.default_value = val
b.inputs['Specular IOR Level'].default_value = 0.15
bpy.context.view_layer.update()
# the scan carries a few stray specks far from the airframe, so the extents come from where the
# vertices actually are (0.1 % trimmed each end, then that sliver added back)
import numpy as np  # noqa: E402
co = np.empty(len(jet.data.vertices) * 3)
jet.data.vertices.foreach_get('co', co)
co = -co.reshape(-1, 3)[:, :2]                          # the half turn about z
(X0, Y0), (X1, Y1) = np.percentile(co, 0.1, axis=0), np.percentile(co, 99.9, axis=0)
X0, X1, Y0, Y1 = float(X0) - 0.004, float(X1) + 0.012, float(Y0) - 0.004, float(Y1) + 0.004
L, YC = X1 - X0, (Y0 + Y1) / 2
fx = lambda t: X0 + t * L                                # station along the fuselage, 0 tail .. 1 nose
print('BOUNDS', round(X0, 3), round(X1, 3), round(Y0, 3), round(Y1, 3), flush=True)
# measured off the reference: glazing arc centred 0.905 L from the tail, titles forward, registration aft
GLASS = (fx(0.884), 0.0, 0.0232 * L, 0.0285 * L)
TITLE = (fx(0.775), 0.039 * L, 0.0088 * L)
REG = (fx(0.30), 0.047 * L, 0.0088 * L)

# the scan's glazing is one black smear round the upper deck: in the nose those dark texels are
# painted back to the airframe white (shading untouched), and six clean panes are set over it
link = next(lk for lk in nt.links if lk.to_socket == b.inputs['Base Color'])
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
rgb = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(link.from_socket, rgb.inputs['Color'])


def mth(op, a_, b_=None):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    for i, v in enumerate((a_, b_)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


nose = mth('MULTIPLY', mth('LESS_THAN', sep.outputs['X'], -fx(0.78)), mth('LESS_THAN', mth('ABSOLUTE', sep.outputs['Y']), 0.07 * L))
darkm = mth('MULTIPLY', nose, mth('LESS_THAN', mth('MAXIMUM', rgb.outputs['Red'], mth('MAXIMUM', rgb.outputs['Green'], rgb.outputs['Blue'])), 0.62))
fix = nt.nodes.new('ShaderNodeMix')
fix.data_type = 'RGBA'
rgba = lambda socks, n: next(sk for sk in socks if sk.name == n and sk.type == 'RGBA')
nt.links.new(darkm, fix.inputs['Factor'])
nt.links.new(link.from_socket, rgba(fix.inputs, 'A'))
rgba(fix.inputs, 'B').default_value = NOSE_WHITE
# the scan's bare-metal leading edges came out as broad dark bands; the reference's are a thin pale
# grey, so neutral dark texels out on the wings and tailplane are lifted (red tips are left alone)
mx_ = mth('MAXIMUM', rgb.outputs['Red'], mth('MAXIMUM', rgb.outputs['Green'], rgb.outputs['Blue']))
mn_ = mth('MINIMUM', rgb.outputs['Red'], mth('MINIMUM', rgb.outputs['Green'], rgb.outputs['Blue']))
neutral = mth('LESS_THAN', mth('SUBTRACT', mx_, mn_), 0.12)
wingm = mth('MULTIPLY', mth('GREATER_THAN', mth('ABSOLUTE', sep.outputs['Y']), 0.056 * L), mth('MULTIPLY', neutral, mth('LESS_THAN', mx_, EDGE_T)))
wingm = mth('MULTIPLY', wingm, mth('GREATER_THAN', mx_, 0.2))            # the dark gear fairings stay dark
lift = nt.nodes.new('ShaderNodeMix')
lift.data_type = 'RGBA'
nt.links.new(mth('MULTIPLY', wingm, EDGE_K), lift.inputs['Factor'])
nt.links.new(rgba(fix.outputs, 'Result'), rgba(lift.inputs, 'A'))
rgba(lift.inputs, 'B').default_value = EDGE_GREY
nt.links.new(rgba(lift.outputs, 'Result'), b.inputs['Base Color'])

# ----------------------------------------------------------------------------- overlays
# the camera is orthographic and straight down, so flat pieces above the airframe sit exactly
# where they are drawn (world x = nose-right, after the half turn)
Z = 0.4


def flat(name, pts, m):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, y, Z)) for x, y in pts])
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    s.collection.objects.link(o)
    o.data.materials.append(m)
    o.visible_shadow = False
    return o


def ink(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree
    n.nodes.remove(n.nodes['Principled BSDF'])
    em = n.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*lib.srgb(color), 1)
    em.inputs['Strength'].default_value = strength * 2 ** (-EXPOSURE)
    n.links.new(em.outputs['Emission'], n.nodes['Material Output'].inputs['Surface'])
    return m


if not args.bare:
    glass = ink('glass', '#141a22')
    glint = ink('glint', '#3b4a5c')
    frame = ink('frame', '#dcdfe3')
    # six panes on an arc round the front of the upper deck (centre CX, radius RAD)
    CX, RAD, W0, W1 = GLASS
    # measured off the reference: a small arc (4 % of the length across), on each side one long front
    # pane and two short ones behind it, a gap on the centreline
    for sgn in (-1, 1):
        for i, (d0, d1) in enumerate(((3, 27), (31, 43), (47, 57))):
            a0, a1 = sgn * math.radians(d0), sgn * math.radians(d1)
            steps = max(2, (d1 - d0) // 4)
            arc = [a0 + (a1 - a0) * j / steps for j in range(steps + 1)]
            quad = [(CX + W0 * math.cos(a), YC + W0 * math.sin(a)) for a in arc] + [(CX + W1 * math.cos(a), YC + W1 * math.sin(a)) for a in reversed(arc)]
            flat(f'pane{sgn}{i}', quad, glass)
    text_m = ink('titles', '#0d141c')
    for sgn in (-1, 1):
        # each side reads from its own side of the aircraft, as painted on a real fuselage
        rot = (0, 0, 0) if sgn < 0 else (0, 0, math.pi)
        for nm, body, (tx, ty, size) in (('title', 'BALAR OVERSEAS', TITLE), ('reg', 'VT-BLR', REG)):
            t = lib.text(f'{nm}{sgn}', body, size, (tx, YC + sgn * ty, Z), text_m, rot=rot, extrude=0.0, align='CENTER')
            t.data.align_y = 'CENTER'
            t.data.offset = 0.035 * size                  # a bolder stroke: thin lettering greys out at page size
            t.visible_shadow = False

# ----------------------------------------------------------------------------- light, camera
sun = lib.studio_light(sun_dir=(0, 0, 0), strength=1.35, sky_strength=0.07)   # the sky dome carries its own sun: keep it low
sun.data.angle = math.radians(40)                    # broad soft light from straight above: hardly any shaded side
# the sky dome has a sun of its own off to one side, which shades half the airframe: an even white
# dome instead, so the jet reads flat white from above as the reference does
wn = s.world.node_tree
bg = wn.nodes['Background']
for lk in list(bg.inputs['Color'].links):
    wn.links.remove(lk)
bg.inputs['Color'].default_value = WARM
sun.data.color = WARM[:3]
bg.inputs['Strength'].default_value = DOME
sun.data.energy = SUN
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = max(L, Y1 - Y0) / 0.992       # the whole span with a hair of margin, as the reference frames it
cam = bpy.data.objects.new('cam', cam_data)
s.collection.objects.link(cam)
s.camera = cam
cam.location = ((X0 + X1) / 2, YC, 5)

os.makedirs(args.out, exist_ok=True)
s.render.filepath = os.path.join(args.out, 'jet.webp')
bpy.ops.render.render(write_still=True)
print('RENDERED', flush=True)
