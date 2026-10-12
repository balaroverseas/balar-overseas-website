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
ap.add_argument('--count', type=int, default=0)      # N evenly spaced frames of the export, written f001..fN
ap.add_argument('--mob', action='store_true')      # the phone staging (page ?mob): seen from the far side, so the sun and the shadow ground swap sides
ap.add_argument('--resume', action='store_true')   # skip frames already on disk (power cuts)
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


off = set()                                   # switched off at the start, with everything under them
for n in hidden:
    if n in objs:
        o = objs[n]
        o.hide_render = True
        off.add(n)
        for c in o.children_recursive:
            c.hide_render = True
            off.add(c.name)


# ---------------------------------------------------------------- the scan's full-resolution maps
# the page exports the scanned stacker with 2K copies of its textures (WebGL); the render takes the
# full-resolution ones straight from the prep script's _hi file (same meshes, same UVs)
HI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'models', 'stacker_meshy_hi.glb'))   # abspath: the raw '..' form overruns MAX_PATH here
scan = [m for m in bpy.data.materials if m.name.startswith('MESHY') and m.use_nodes]


def tex_nodes(mat):
    """Principled input name -> the image node feeding it"""
    b = mat.node_tree.nodes.get('Principled BSDF')
    out = {}
    for key in ('Base Color', 'Metallic', 'Normal'):
        n = b.inputs[key].links[0].from_node if b and b.inputs[key].is_linked else None
        while n and n.type != 'TEX_IMAGE':
            n = next((i.links[0].from_node for i in n.inputs if i.is_linked), None)
        if n:
            out[key] = n
    return out


if scan and os.path.exists(HI):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=HI)
    fresh = [o for o in bpy.data.objects if o not in before]
    src = tex_nodes(next(o for o in fresh if o.type == 'MESH').active_material)
    for m in scan:
        for key, node in tex_nodes(m).items():
            if key in src:
                node.image = src[key].image
    print('SCAN MAPS', {k: n.image.size[:] for k, n in src.items()})
    for o in fresh:
        bpy.data.objects.remove(o)

# lettering is drawn on thin see-through planes a few cm off the surface: in a path tracer each one
# would throw its own shadow onto the wall behind it (a blurred double of the text) -> no shadows
for o in sc.objects:
    m = o.active_material if o.type == 'MESH' else None
    if m and m.use_nodes and not m.name.startswith('MESHY'):
        b = m.node_tree.nodes.get('Principled BSDF')
        if b and b.inputs['Alpha'].is_linked and len(o.data.polygons) <= 4:
            o.visible_shadow = False
            o.visible_diffuse = False          # nor dim the wall behind by blocking bounced light
            o.visible_glossy = False
            # flat ink: no sheen from the sky, so dark lettering stays dark and white stays clean
            b.inputs['Roughness'].default_value = 1.0
            b.inputs['Specular IOR Level'].default_value = 0.0

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

# ---------------------------------------------------------------- the scanned container
# (assets/models/container_meshy*.glb, material CONTM). Its full-resolution maps come from the _hi
# file like the stacker's. The generator cannot hold small lettering: what it drew on the doors is
# painted out (three patches on each end, the lock rods left alone) and written again as real text.
CONT_HI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'models', 'container_meshy_hi.glb'))
cont_mats = [m for m in bpy.data.materials if m.name.startswith('CONTM') and m.use_nodes]
if cont_mats and os.path.exists(CONT_HI):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=CONT_HI)
    fresh = [o for o in bpy.data.objects if o not in before]
    src = tex_nodes(next(o for o in fresh if o.type == 'MESH').active_material)
    for m in cont_mats:
        for key, node in tex_nodes(m).items():
            if key in src:
                node.image = src[key].image
    for o in fresh:
        bpy.data.objects.remove(o)

# patches in the container's own frame: u runs to the viewer's right across the door, z is height
PATCHES = [(0.229, 1.135, 2.025, 2.335), (0.200, 0.965, 1.510, 1.800), (0.200, 0.965, 1.180, 1.350)]
RODS = [0.240, 0.606]
PAINT = (0.651, 0.672, 0.693, 1.0)          # the doors' own paint, read off the scan's colour map beside the lettering
MOB_TONE_SIDE = (0.54, 0.80, 1.0, 1.0)
MOB_TONE = (0.62, 0.66, 0.473, 1.0)           # see the phone note below (linear multipliers)


def mnode(nt, op, a, b=None):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


for m in cont_mats:
    nt = m.node_tree
    img = tex_nodes(m).get('Base Color')
    if not img:
        continue
    users = [l.to_socket for l in img.outputs['Color'].links]     # taken before anything here reads the map too
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    x, y, z = sep.outputs
    end = mnode(nt, 'GREATER_THAN', mnode(nt, 'ABSOLUTE', x), 5.6)
    u = mnode(nt, 'MULTIPLY', y, mnode(nt, 'SIGN', x))
    zone = None
    for u0, u1, z0, z1 in PATCHES:
        k = mnode(nt, 'MULTIPLY', mnode(nt, 'MULTIPLY', mnode(nt, 'GREATER_THAN', u, u0), mnode(nt, 'LESS_THAN', u, u1)),
                 mnode(nt, 'MULTIPLY', mnode(nt, 'GREATER_THAN', z, z0), mnode(nt, 'LESS_THAN', z, z1)))
        zone = k if zone is None else mnode(nt, 'MAXIMUM', zone, k)
    # where a lock rod crosses a patch only what is dark (ink) goes: the rod itself is as light as the paint
    bw = nt.nodes.new('ShaderNodeRGBToBW')
    nt.links.new(img.outputs['Color'], bw.inputs[0])
    dark = mnode(nt, 'LESS_THAN', bw.outputs[0], 0.36)
    keep = None
    for r in RODS:
        k = mnode(nt, 'LESS_THAN', mnode(nt, 'ABSOLUTE', mnode(nt, 'SUBTRACT', u, r)), 0.05)
        keep = k if keep is None else mnode(nt, 'MAXIMUM', keep, k)
    zone = mnode(nt, 'MULTIPLY', zone, mnode(nt, 'MAXIMUM', mnode(nt, 'SUBTRACT', 1.0, keep), dark))
    mask = mnode(nt, 'MULTIPLY', zone, end)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['B'].default_value = PAINT
    # repaint: the colour in the material's name (CONTM_rrggbb) replaces the paint only — what is
    # light and colourless in the map; seals, hazard tape, stickers and plates stay as they are
    out = mix.outputs['Result']
    hexc = m.name.split('_')[1][:6] if '_' in m.name else ''
    if len(hexc) == 6:
        lin = [((int(hexc[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)]
        hsv = nt.nodes.new('ShaderNodeSeparateColor')
        hsv.mode = 'HSV'
        nt.links.new(out, hsv.inputs[0])
        # a soft edge on "colourless": the scan's paint drifts a little cream in places, and a hard cut
        # left those places unpainted, as pale streaks down the sides
        soft = nt.nodes.new('ShaderNodeMapRange')
        soft.interpolation_type = 'SMOOTHSTEP'
        soft.inputs['From Min'].default_value = 0.30
        soft.inputs['From Max'].default_value = 0.55
        soft.inputs['To Min'].default_value = 1.0
        soft.inputs['To Max'].default_value = 0.0
        nt.links.new(hsv.outputs[1], soft.inputs['Value'])
        is_paint = mnode(nt, 'MULTIPLY', soft.outputs['Result'], mnode(nt, 'GREATER_THAN', hsv.outputs[2], 0.30))
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        base = 0.2126 * PAINT[0] + 0.7152 * PAINT[1] + 0.0722 * PAINT[2]
        mul.inputs['B'].default_value = (lin[0] / base, lin[1] / base, lin[2] / base, 1)
        # the new coat goes over the paint's light and shade only, not over its own (cream, lilac) casts
        grey = nt.nodes.new('ShaderNodeRGBToBW')
        nt.links.new(out, grey.inputs[0])
        nt.links.new(grey.outputs[0], mul.inputs['A'])
        pick = nt.nodes.new('ShaderNodeMix')
        pick.data_type = 'RGBA'
        nt.links.new(is_paint, pick.inputs['Factor'])
        nt.links.new(out, pick.inputs['A'])
        nt.links.new(mul.outputs['Result'], pick.inputs['B'])
        out = pick.outputs['Result']
        m['dark_paint'] = (0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]) < 0.2
    # phones: the reference's grey box is a neutral light grey there (top view 196,196,196, door end
    # ~185), where ours came out near white with a lilac cast from the sky; the grey box alone is toned
    if args.mob and hexc.lower() not in ('2169b3', 'd34618'):
        tone = nt.nodes.new('ShaderNodeMix')
        tone.data_type = 'RGBA'
        tone.blend_type = 'MULTIPLY'
        tone.inputs['Factor'].default_value = 1.0
        # the roof takes the sky's blue and the walls the sun's cream, so each gets its own tone
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        nz = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['True Normal'], nz.inputs[0])
        up = nt.nodes.new('ShaderNodeMapRange')
        up.inputs['From Min'].default_value = 0.5
        up.inputs['From Max'].default_value = 0.9
        nt.links.new(nz.outputs['Z'], up.inputs['Value'])
        tcol = nt.nodes.new('ShaderNodeMix')
        tcol.data_type = 'RGBA'
        tcol.inputs['A'].default_value = MOB_TONE_SIDE
        tcol.inputs['B'].default_value = MOB_TONE
        nt.links.new(up.outputs['Result'], tcol.inputs['Factor'])
        nt.links.new(tcol.outputs['Result'], tone.inputs['B'])
        nt.links.new(out, tone.inputs['A'])
        out = tone.outputs['Result']
    for sock in users:
        nt.links.new(out, sock)
    # the scan's normal map is rough on the flat walls: under the sun and the blue sky each facet took
    # its own tint (pink and lilac bands along the sides); at half strength the wall reads as one colour
    for n in nt.nodes:
        if n.type == 'NORMAL_MAP':
            n.inputs['Strength'].default_value = 0.45
    nt.links.new(img.outputs['Color'], mix.inputs['A'])
    nt.links.new(mask, mix.inputs['Factor'])

ink = bpy.data.materials.new('CONT_INK')
ink.use_nodes = True
ib = ink.node_tree.nodes['Principled BSDF']
ib.inputs['Base Color'].default_value = (0.015, 0.016, 0.018, 1)
ib.inputs['Roughness'].default_value = 1.0
ib.inputs['Specular IOR Level'].default_value = 0.0
ink_white = ink.copy()
ink_white.name = 'CONT_INK_WHITE'
ink_white.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.85, 0.86, 0.87, 1)   # on dark paint the lettering is white
# (text, u of its left edge, z of its baseline, size)
# kept clear of the two lock rods (u 0.24 and 0.61): the owner code between them, the rest to the right
LINES = [('BLRU', 0.300, 2.195, 0.108), ('210450 7', 0.668, 2.195, 0.108), ('45G1', 0.668, 2.050, 0.108),
         ('MAX. GR.', 0.298, 1.700, 0.057), ('TARE', 0.298, 1.585, 0.057), ('CU. CAP.', 0.298, 1.240, 0.057),
         ('30,480 KGS', 0.672, 1.735, 0.046), ('67,200 LBS', 0.672, 1.675, 0.046), ('3,750 KGS', 0.672, 1.610, 0.046), ('8,270 LBS', 0.672, 1.550, 0.046),
         ('67.7 CU.M', 0.672, 1.280, 0.046), ('2,390 CU.FT', 0.672, 1.220, 0.046)]
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
boxes = [o for o in sc.objects if o.type == 'MESH' and o.active_material and o.active_material.name.startswith('CONTM')]
print('CONTAINERS', len(boxes))
for box in boxes:
    for s in (1, -1):
        # where the door panel stands along the box (ray down the length onto a clear part of the panel)
        hit, loc, _n, _i = box.evaluated_get(dg).ray_cast(Vector((s * 8.0, s * 0.90, 2.12)), Vector((-s, 0, 0)))
        face = abs(loc.x) if hit else 6.0
        for text, u, z, size in LINES:
            cu = bpy.data.curves.new('lettering', 'FONT')
            cu.body = text
            cu.size = size
            cu.offset = size * 0.035           # a heavier stroke, like stencilled paint
            t = bpy.data.objects.new('lettering', cu)
            sc.collection.objects.link(t)
            t.data.materials.append(ink_white if box.active_material.get('dark_paint') else ink)
            t.parent = box
            # reads along u, stands up along z, faces out of the end
            t.matrix_parent_inverse = Matrix.Identity(4)
            t.matrix_local = Matrix(((0, 0, s, s * (face + 0.004)), (s, 0, 0, s * u), (0, 1, 0, z), (0, 0, 0, 1)))
            t.visible_shadow = False

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
    kids = [c for c in o.children_recursive if c.name not in off and c not in movers]   # never wake a switched-off part
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
d = Vector((14, 24 if args.mob else -24, 40)).normalized()   # page: SUN_OFFSET (14, 40, 24), z flipped for ?mob
sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
# ground: catches shadows only, composited over the page white
# kept behind the kerb line on the camera's side: late in the phase the camera drops just below ground
# level, and a shadow catcher seen from underneath hides everything standing on it (the truck vanished)
# (?mob: the side camera stands on the other side, below ground level too: the ground then starts just
# in front of the boxes' near ends, three z = -20.1)
bpy.ops.mesh.primitive_plane_add(size=600, location=(0, -279.9 if args.mob else 297, -0.01))
gp = bpy.context.object
gp.is_shadow_catcher = True
gp.hide_render = args.mob          # the phone staging has no ground shadows (flat dark page, like the reference)

# ---------------------------------------------------------------- render
sc.render.engine = 'CYCLES'
cyc = sc.cycles
cyc.device = 'CPU'                 # the machine's CUDA card (sm_60) has no Cycles kernels in 5.2
cyc.samples = args.samples
cyc.use_denoising = True
cyc.max_bounces = 6
cyc.filter_width = 1.0             # crisper edges than the 1.5 px default (frames are shown near 1:1)
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y = rx, ry
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'WEBP'
sc.render.image_settings.quality = 92
sc.render.image_settings.color_mode = 'RGBA'     # transparent with the shadows in alpha: the page white shows through

os.makedirs(args.out, exist_ok=True)
if '-' in args.frames:
    a, b = map(int, args.frames.split('-'))
    frames = range(a, b + 1)
else:
    frames = [int(x) for x in args.frames.split(',')]
names = {f: f for f in frames}
if args.count:
    pick = [round(1 + k * (F - 1) / (args.count - 1)) for k in range(args.count)]
    names = {src: k + 1 for k, src in enumerate(pick) if src in names}
    frames = [f for f in pick if f in names]
for f in frames:
    sc.frame_set(f)
    sc.render.filepath = os.path.join(args.out, f'f{names[f]:03d}.webp')
    if args.resume and os.path.exists(sc.render.filepath) and os.path.getsize(sc.render.filepath) > 2000:
        continue
    bpy.ops.render.render(write_still=True)
print('DEVICE', cyc.device)
