"""Container ship seen from straight above: the camera starts low over the container bays,
slides towards the bow, then climbs until the whole ship sits small in a deep blue sea
and drifts into clouds (frames 1–200). Opaque frames (sea everywhere), WebP + scroll.

  blender -b -P ship.py -- --frames 1,80,200 --samples 16 --res 960x540
  blender -b -P ship.py -- --frames 1-200 --samples 32 --res 1600x900
"""
import sys
import os
import math
import random
import argparse
import bpy
import bmesh

sys.path.append(os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, cylinder, mat, empty, seg, lerp, srgb, prism, node, cloud_mat, plane  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--frames', default='1')
ap.add_argument('--samples', type=int, default=32)
ap.add_argument('--res', default='1600x900')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'seq', 'ship'))
args = ap.parse_args(argv)
rx, ry = map(int, args.res.split('x'))

LAST = 200
s = lib.reset(samples=args.samples, res=(rx, ry), transparent=False)
s.frame_start, s.frame_end = 1, LAST
s.cycles.max_bounces = 4
s.cycles.transparent_max_bounces = 16
# the reference's boxes are vivid: AgX washed them to pastels, Standard keeps the paint as authored
s.view_settings.view_transform = 'Standard'
s.view_settings.look = 'None'
s.view_settings.exposure = -0.6
rnd = random.Random(7)


# ----------------------------------------------------------------------------- helpers


def roof_mat(name, color):
    """Container steel seen from above: ribs across the width, slight grime."""
    m = mat(name, color, metal=0.0, rough=0.7)       # matt paint: no sky sheen washing it out from above
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wave = node(nt, 'ShaderNodeTexWave', Scale=3.4)
    wave.bands_direction = 'Y'
    wave.wave_profile = 'SAW'
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    bump = node(nt, 'ShaderNodeBump', Strength=0.8, Distance=0.08)
    nt.links.new(wave.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    noise = node(nt, 'ShaderNodeTexNoise', Scale=1.5)
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*[c * 0.8 for c in srgb(color)], 1)
    ramp.color_ramp.elements[1].color = (*srgb(color), 1)
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m


def sea_mat():
    """Deep blue open sea: two scales of ripples, sparse whitecaps; scrolls to fake motion."""
    m = bpy.data.materials.new('sea')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.3     # dull enough that the sun never glares
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.name = 'sea_map'
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    swell = node(nt, 'ShaderNodeTexNoise', Scale=0.035, Detail=4.0, Roughness=0.55)
    chop = node(nt, 'ShaderNodeTexNoise', Scale=0.45, Detail=6.0, Roughness=0.6)
    caps = node(nt, 'ShaderNodeTexNoise', Scale=0.22, Detail=12.0, Roughness=0.75)
    for n in (swell, chop):
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    streak = nt.nodes.new('ShaderNodeVectorMath')                    # wind streaks like the reference
    streak.operation = 'MULTIPLY'
    streak.inputs[1].default_value = (1.0, 0.28, 1.0)
    nt.links.new(mp.outputs['Vector'], streak.inputs[0])
    nt.links.new(streak.outputs['Vector'], caps.inputs['Vector'])
    b1 = node(nt, 'ShaderNodeBump', Strength=0.35, Distance=1.0)
    b2 = node(nt, 'ShaderNodeBump', Strength=0.25, Distance=0.25)
    nt.links.new(swell.outputs['Fac'], b1.inputs['Height'])
    nt.links.new(chop.outputs['Fac'], b2.inputs['Height'])
    nt.links.new(b1.outputs['Normal'], b2.inputs['Normal'])
    nt.links.new(b2.outputs['Normal'], b.inputs['Normal'])
    deep = nt.nodes.new('ShaderNodeValToRGB')
    deep.color_ramp.elements[0].color = (*srgb('#03113f'), 1)
    deep.color_ramp.elements[1].color = (*srgb('#0a2a78'), 1)
    nt.links.new(swell.outputs['Fac'], deep.inputs['Fac'])
    cap = nt.nodes.new('ShaderNodeValToRGB')
    cap.color_ramp.elements[0].position = 0.61
    cap.color_ramp.elements[1].position = 0.67
    nt.links.new(caps.outputs['Fac'], cap.inputs['Fac'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(cap.outputs['Color'], mix.inputs['Factor'])
    nt.links.new(deep.outputs['Color'], mix.inputs[6])
    mix.inputs[7].default_value = (0.85, 0.9, 0.95, 1)
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def foam_mat(name, along='Y', length=150.0, scale=0.25, strength=1.0):
    """White churned water with ragged alpha, fading out along local -`along`."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes['Material Output']
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.9, 0.94, 0.97, 1)
    b.inputs['Roughness'].default_value = 0.6
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.name = 'foam_map'
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = node(nt, 'ShaderNodeTexNoise', Scale=scale, Detail=12.0, Roughness=0.7)
    nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[1].position = 0.62
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    fade = nt.nodes.new('ShaderNodeMapRange')
    fade.inputs['From Min'].default_value = 0
    fade.inputs['From Max'].default_value = -length
    fade.inputs['To Min'].default_value = 1
    fade.inputs['To Max'].default_value = 0
    nt.links.new(sep.outputs[along], fade.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(ramp.outputs['Color'], mul.inputs[0])
    nt.links.new(fade.outputs['Result'], mul.inputs[1])
    k = nt.nodes.new('ShaderNodeMath')
    k.operation = 'MULTIPLY'
    k.inputs[1].default_value = strength
    nt.links.new(mul.outputs['Value'], k.inputs[0])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(k.outputs['Value'], mx.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mx.inputs[1])
    nt.links.new(b.outputs['BSDF'], mx.inputs[2])
    nt.links.new(mx.outputs['Shader'], out.inputs['Surface'])
    return m


# ----------------------------------------------------------------------------- ship
# bow points +Y (up on screen); deck at z = DECK
DECK = 3.0
HALF = 8.0                                 # 5 container columns, like the reference
ship = empty('ship')
hull_m = mat('hull', '#1b2436', metal=0.3, rough=0.45, coat=0.4)
rim_m = mat('rim', '#2c3f5e', metal=0.3, rough=0.5)
deck_m = mat('deck', '#3d5675', metal=0.2, rough=0.6)
fore_m = mat('foredeck', '#3f6b5c', metal=0.1, rough=0.7)
white = mat('super_white', '#eef0f2', rough=0.35, coat=0.6)
dark = mat('ship_dark', '#1c2026', metal=0.4, rough=0.5)
window = mat('windows', '#0e1620', rough=0.05, coat=1.0)
indigo = mat('funnel_indigo', '#3b2cff', metal=0.2, rough=0.3, coat=1.0)
orange = mat('funnel_orange', '#ff8a3d', rough=0.35, coat=0.8)
yellow = mat('rail_yellow', '#f2c230', rough=0.4)
red = mat('winch_red', '#b8322b', rough=0.4, coat=0.5)
grey = mat('bridge_grey', '#8d99a8', metal=0.5, rough=0.4)

side = [(5.4, -58), (7.6, -56.5), (HALF, -52), (HALF, 30), (7.75, 37), (6.75, 44), (5.0, 50), (2.7, 55), (0, 58)]
outline = side + [(-x, y) for x, y in reversed(side[:-1])]
prism('hull', outline, -4, DECK, hull_m, bevel=0.4, parent=ship)
inner = [(x * 0.93 if x else 0, y * 0.985) for x, y in outline]
prism('deck', inner, DECK - 0.4, DECK + 0.05, deck_m, bevel=0.1, parent=ship)
prism('bulwark_fore', [(x, y) for x, y in outline if y > 40] + [(-5.0, 40), (5.0, 40)], DECK, DECK + 1.2, rim_m, bevel=0.1, parent=ship)
prism('foredeck', [(x * 0.9, y) for x, y in outline if y > 41] + [(-4.7, 41), (4.7, 41)], DECK + 1.2, DECK + 1.3, fore_m, bevel=0.05, parent=ship)

# container bays: 6 bays x 6 columns of 40ft boxes with lashing bridges between
# saturated like the reference (blues, magenta/pink, violet, red, orange, the odd white/green)
PALETTE = ['#2a6fd6', '#e2508f', '#6a2bd8', '#d8342c', '#ff7a2a', '#1c3fae', '#c2185b', '#3022c9', '#1f8a3a', '#f0f0f0', '#4fa3f0', '#ff4f6a']
roofs = [roof_mat(f'roof{i}', c) for i, c in enumerate(PALETTE)]
# the truck's light-grey box stays on screen as the ship slides up under it: the centre column of
# the bays that pass beneath it is the same grey, so the box seems to land on the ship (reference)
truck_box = roof_mat('roof_truckbox', '#c4c9cf')
TRUCK_COL, TRUCK_BAYS = 2, (0, 1, 2, 3)
BAY_LEN, BRIDGE = 12.19, 1.5
COLS = 5
y = -50.0                                  # bays from the stern up to the forward bridge
for bay in range(6):
    yc = y + BAY_LEN / 2
    tiers_base = rnd.choice((3, 4, 4, 5))
    for c in range(COLS):
        x = (c - (COLS - 1) / 2) * 2.5
        tiers = max(2, tiers_base + rnd.choice((-1, 0, 0, 0, 1)))
        h = tiers * 2.59
        m_ = rnd.choice(roofs)
        if c == TRUCK_COL and bay in TRUCK_BAYS:
            m_ = truck_box
        box(f'stack{bay}_{c}', (2.44, BAY_LEN, h), (x, yc, DECK + 0.3 + h / 2), m_, bevel=0.04, segments=1, parent=ship)
    # hatch coaming under the stacks
    box(f'coaming{bay}', (COLS * 2.5 + 0.6, BAY_LEN + 0.4, 0.5), (0, yc, DECK + 0.1), rim_m, bevel=0.05, parent=ship)
    # lashing bridge forward of the bay
    yb = y + BAY_LEN + BRIDGE / 2
    if bay < 5:
        box(f'lash{bay}', (COLS * 2.5 + 1.2, 1.0, 4.2), (0, yb, DECK + 2.1), grey, bevel=0.05, parent=ship)
        box(f'lash_rail{bay}', (COLS * 2.5 + 1.2, 0.08, 0.08), (0, yb + 0.45, DECK + 4.3), yellow, parent=ship)
        box(f'lash_rail2{bay}', (COLS * 2.5 + 1.2, 0.08, 0.08), (0, yb - 0.45, DECK + 4.3), yellow, parent=ship)
    y += BAY_LEN + BRIDGE

# bow: breakwater, winches, bollards, foremast
for sgn in (-1, 1):
    bw = box(f'breakwater{sgn}', (5.4, 0.35, 2.2), (sgn * 2.1, 44.6, DECK + 1.6), rim_m, bevel=0.04, parent=ship)
    bw.rotation_euler = (0, 0, sgn * 0.42)
    for i, yy in enumerate((45.5, 49.5)):
        cylinder(f'winch{sgn}{i}', 0.9, 1.6, (sgn * 3.2, yy, DECK + 2.0), red, axis='X', parent=ship)
    for yy in (44, 47.5, 51):
        cylinder(f'bollard{sgn}{yy}', 0.28, 0.7, (sgn * 5.2 * (1 - (yy - 44) / 30), yy, DECK + 1.6), dark, axis='Z', parent=ship)
cylinder('foremast', 0.25, 8, (0, 53.5, DECK + 5), white, axis='Z', parent=ship)
box('foremast_x', (2.4, 0.2, 0.2), (0, 53.5, DECK + 8.0), white, parent=ship)

# reference ship: accommodation + bridge FORWARD (behind the forecastle), funnel/engine casing aft
box('accom', (12.5, 7, 16), (0, 37.5, DECK + 8), white, bevel=0.2, parent=ship)
box('bridge_deck', (2 * HALF + 0.6, 4.0, 2.4), (0, 39.0, DECK + 16.6), white, bevel=0.15, parent=ship)
box('bridge_windows', (2 * HALF + 0.65, 0.1, 1.1), (0, 41.05, DECK + 16.7), window, bevel=0.02, parent=ship)
box('bridge_roof', (14, 5.5, 0.3), (0, 38.2, DECK + 18), white, bevel=0.08, parent=ship)
box('radar_mast', (1.2, 1.2, 5), (0, 37.5, DECK + 20.5), white, bevel=0.05, parent=ship)
for i, xx in enumerate((-2.2, 2.2)):
    box(f'radar{i}', (3.4, 0.25, 0.2), (xx, 37.5 + i * 1.5, DECK + 22.8 - i * 1.5), dark, parent=ship)
box('engine_casing', (10, 6, 9), (0, -53.0, DECK + 4.5), white, bevel=0.2, parent=ship)
box('funnel', (4.4, 4.8, 14), (0, -53.0, DECK + 7), indigo, bevel=0.5, parent=ship)
box('funnel_band', (4.45, 4.85, 1.2), (0, -53.0, DECK + 12.0), orange, bevel=0.5, parent=ship)
box('funnel_top', (4.0, 4.4, 0.5), (0, -53.0, DECK + 14.1), dark, bevel=0.3, parent=ship)
for i, xx in enumerate((-0.9, 0.9)):
    cylinder(f'exhaust{i}', 0.55, 1.5, (xx, -51.5, DECK + 26.6), dark, axis='Z', parent=ship)
lib.text('funnel_logo', 'BALAR', 1.1, (-1.95, -55.42, DECK + 9.0), white, parent=ship)
for sgn in (-1, 1):                       # lifeboats on davits
    box(f'lifeboat{sgn}', (1.8, 6.5, 1.6), (sgn * 6.7, 36.0, DECK + 7), orange, bevel=0.7, parent=ship)
box('stern_deck', (11, 3, 0.3), (0, -56.5, DECK + 0.2), deck_m, bevel=0.05, parent=ship)
for sgn in (-1, 1):
    cylinder(f'stern_winch{sgn}', 0.8, 1.4, (sgn * 3.5, -56.8, DECK + 1.1), red, axis='X', parent=ship)

# ----------------------------------------------------------------------------- sea, wake, clouds
sea = sea_mat()
water = plane('sea', 3000, 3000, (0, 0, 0), sea)
wake_m = foam_mat('wake', length=200, scale=0.3, strength=0.55)
me = bpy.data.meshes.new('wake')
bm = bmesh.new()
pts = [(-6.5, -57), (6.5, -57), (40, -320), (-40, -320)]
bm.faces.new([bm.verts.new((x, yy, 0.06)) for x, yy in pts])
bm.to_mesh(me)
bm.free()
wake = bpy.data.objects.new('wake', me)
s.collection.objects.link(wake)
wake.data.materials.append(wake_m)
wake.location = (0, 0, 0)
# bow waves: churned strips down both sides, strongest at the bow
for sgn in (-1, 1):
    bme = bpy.data.meshes.new(f'bowwave{sgn}')
    bm = bmesh.new()
    # local origin at the bow so the foam fades out towards the stern
    quad = [(sgn * 3.2, 0), (sgn * 9.6, -16), (sgn * 15.0, -86), (sgn * 9.2, -26)]
    bm.faces.new([bm.verts.new((x, yy, 0.07)) for x, yy in quad])
    bm.to_mesh(bme)
    bm.free()
    bw = bpy.data.objects.new(f'bowwave{sgn}', bme)
    s.collection.objects.link(bw)
    bw.data.materials.append(foam_mat(f'bowfoam{sgn}', length=90, scale=0.5))
    bw.location = (0, 56, 0)
# The reference looks straight down with almost no perspective (only container roofs, no sides):
# camera heights and lens are both VERT× the measured framing, so the footprint stays the same
VERT = 3.0
clouds = []
for i, z in enumerate((300 * VERT, 380 * VERT, 470 * VERT)):
    clouds.append(plane(f'cloud{i}', 2600, 2600, (0, 0, z), cloud_mat(f'cloud{i}', i + 1)))

lib.studio_light(sun_dir=(-30, 0, -20), strength=1.05, sky_strength=0.08)   # angled sun: no glint patch under the camera (reference shows none)

# ----------------------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 48 * VERT
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.sensor_width = 36
cam_data.clip_end = 5000 * VERT
cam = bpy.data.objects.new('cam', cam_data)
s.collection.objects.link(cam)
s.camera = cam
cam.rotation_euler = (0, 0, 0)     # straight down, +Y (bow) up on screen

sea_map = sea.node_tree.nodes['sea_map']
foam_maps = [o.data.materials[0].node_tree.nodes['foam_map'] for o in [wake] + [o for o in s.objects if o.name.startswith('bowwave')]]


# camera height measured off the reference (hull width on screen at each point of the section);
# frames are spread linearly over the section (frame = 1 + 199·S/0.97), so the page needs no remap
# first frame: the section scrolls in under the end of the road scene, and like the reference the
# container block continues the vertical road (measured at 1280×720: road 227px, boxes 258px, hull ~355px)
Z_KEYS = [(1, 86), (21, 70), (38, 70), (54, 79), (75, 93), (128, 152), (136, 194), (157, 267), (177, 790), (200, 1000)]


def cam_z(f):
    for (f0, z0), (f1, z1) in zip(Z_KEYS, Z_KEYS[1:]):
        if f <= f1:
            u = (f - f0) / (f1 - f0)
            return math.exp(lerp(math.log(z0), math.log(z1), u))    # even zoom feel
    return Z_KEYS[-1][1]


def apply(f):
    t = (f - 1) / (LAST - 1)
    z = cam_z(f) * VERT
    # glide over the bays towards the bow (reference 0–0.36: still only bays, the bridge first
    # shows at the top edge around 0.6), then re-centre on the whole ship (by 0.66)
    yy = lerp(-30, 10, seg(f, 1, 75))
    yy = lerp(yy, 4, seg(f, 75, 136))
    # the road it continues sits a touch right of centre on the page: start under it, settle centred
    cam.location = (-0.15 * (1 - seg(f, 1, 40)), yy, z)       # centre column under the truck (635px)
    sea_map.inputs['Location'].default_value = (0, -t * 90, 0)   # water streams past: ship under way
    for fm in foam_maps:
        fm.inputs['Location'].default_value = (0, -t * 90, 0)
    for c in clouds:                           # clouds hang still while the ship sails on
        c.location.y = -t * 90


for f in range(1, LAST + 1):
    apply(f)
    cam.keyframe_insert('location', frame=f)
    for c in clouds:
        c.keyframe_insert('location', frame=f)
    sea_map.inputs['Location'].keyframe_insert('default_value', frame=f)
    for fm in foam_maps:
        fm.inputs['Location'].keyframe_insert('default_value', frame=f)

# ----------------------------------------------------------------------------- render
os.makedirs(args.out, exist_ok=True)
if '-' in args.frames:
    a, b = map(int, args.frames.split('-'))
    frames = range(a, b + 1)
else:
    frames = [int(x) for x in args.frames.split(',')]
for f in frames:
    s.frame_set(f)
    s.render.filepath = os.path.join(args.out, f'f{f:03d}.webp')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', f, flush=True)
