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
ap.add_argument('--close', default='')            # dev: 'y,height' fixed close-up camera for checks
ap.add_argument('--plan', action='store_true')    # dev: orthographic plan of the whole ship, no sea, clear background
ap.add_argument('--count', type=int, default=0)     # render N frames spread evenly over the range, written f001..fN
ap.add_argument('--resume', action='store_true')   # skip frames already on disk
ap.add_argument('--proc', action='store_true')    # the older all-procedural ship instead of the scanned hull
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'seq', 'ship'))
args = ap.parse_args(argv)
MESHY = not args.proc
rx, ry = map(int, args.res.split('x'))

LAST = 200
s = lib.reset(samples=args.samples, res=(rx, ry), transparent=False)
s.frame_start, s.frame_end = 1, LAST
s.cycles.max_bounces = 4
s.cycles.transparent_max_bounces = 16
# the reference's boxes are vivid: AgX washed them to pastels, Standard keeps the paint as authored
s.view_settings.view_transform = 'Standard'
s.view_settings.look = 'None'
s.view_settings.exposure = -0.25 if MESHY else -0.6     # scanned ship: no sheen on the paint, so less pull-down
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
    b.inputs['Roughness'].default_value = 0.22
    b.inputs['Specular IOR Level'].default_value = 0.22   # some sky glint on the wave faces (reference), not a lilac wash
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
    b1 = node(nt, 'ShaderNodeBump', Strength=0.45, Distance=1.0)
    b2 = node(nt, 'ShaderNodeBump', Strength=0.38, Distance=0.25)
    nt.links.new(swell.outputs['Fac'], b1.inputs['Height'])
    nt.links.new(chop.outputs['Fac'], b2.inputs['Height'])
    nt.links.new(b1.outputs['Normal'], b2.inputs['Normal'])
    nt.links.new(b2.outputs['Normal'], b.inputs['Normal'])
    deep = nt.nodes.new('ShaderNodeValToRGB')
    deep.color_ramp.elements[0].color = (*srgb('#02143d' if MESHY else '#021a4f'), 1)       # reference: deep saturated navy
    deep.color_ramp.elements[1].color = (*srgb('#082564' if MESHY else '#0a3082'), 1)
    nt.links.new(swell.outputs['Fac'], deep.inputs['Fac'])
    cap = nt.nodes.new('ShaderNodeValToRGB')
    cap.color_ramp.elements[0].position = 0.68                      # fewer, finer whitecaps
    cap.color_ramp.elements[1].position = 0.72
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
HALF = 10.5 if MESHY else 10.1                                 # 5 container columns with deck showing between them + side walkways (reference)
PITCH = 3.03 if MESHY else 2.95                               # column spacing: 2.44 m box + ~0.5 m of blue deck between (reference)
ship = empty('ship')
hull_m = mat('hull', '#24508a', metal=0.3, rough=0.45, coat=0.4)     # reference: steel-blue ship
rim_m = mat('rim', '#2a5a96', metal=0.3, rough=0.5)
deck_m = mat('deck', '#0d4673' if MESHY else '#173c70', metal=0.0 if MESHY else 0.2, rough=0.6)
fore_m = mat('foredeck', '#173c70', metal=0.2, rough=0.6)        # blue like the rest of the deck (reference)
white = mat('super_white', '#eef0f2', rough=0.35, coat=0.6)
dark = mat('ship_dark', '#1c2026', metal=0.4, rough=0.5)
window = mat('windows', '#0e1620', rough=0.05, coat=1.0)
indigo = mat('funnel_indigo', '#3b2cff', metal=0.2, rough=0.3, coat=1.0)
orange = mat('funnel_orange', '#ff8a3d', rough=0.35, coat=0.8)
yellow = mat('rail_yellow', '#f2c230', rough=0.4)
red = mat('winch_red', '#b8322b', rough=0.4, coat=0.5)
grate = mat('walk_grate', '#2c3a4c', metal=0.6, rough=0.5)
rail_m = mat('handrail', '#6f88a8', metal=0.5, rough=0.45)       # subtle, not white lines
gunwale_m = mat('gunwale', '#1d4677', metal=0.3, rough=0.55)
steel_m = mat('fittings', '#9aa4ae', metal=0.6, rough=0.45)
grey = mat('bridge_grey', '#0d3a5e' if MESHY else '#163a6a', metal=0.0 if MESHY else 0.5, rough=0.5)          # lashing bridges: blue steel like the deck
hatch_m = mat('hatch', '#0d4878' if MESHY else '#1b4680', metal=0.0 if MESHY else 0.25, rough=0.55)

# as the reference: bow DOWN on screen (pointed end at -Y), accommodation and wake at the top (stern)
side = [(HALF * 0.66, 61), (HALF * 0.92, 59.8), (HALF, 57), (HALF, -38), (HALF * 0.98, -44), (HALF * 0.9, -49), (HALF * 0.72, -53.5), (HALF * 0.5, -56.9), (HALF * 0.22, -57.9), (0, -58)]   # rounded U bow
outline = side + [(-x, y) for x, y in reversed(side[:-1])]
outline.reverse()                                   # keep the winding the prism expects
prism('hull', outline, -4, DECK, hull_m, bevel=0.4, parent=ship)
inner = [(x * 0.93 if x else 0, y * 0.985) for x, y in outline]
prism('deck', inner, DECK - 0.4, DECK + 0.05, deck_m, bevel=0.1, parent=ship)
prism('bulwark_fore', [(5.0, -40), (-5.0, -40)] + [(x, y) for x, y in outline if y < -40], DECK, DECK + 1.2, rim_m, bevel=0.1, parent=ship)
prism('foredeck', [(4.7, -41), (-4.7, -41)] + [(x * 0.9, y) for x, y in outline if y < -41], DECK + 1.2, DECK + 1.3, fore_m, bevel=0.05, parent=ship)

# container bays: 6 bays x 6 columns of 40ft boxes with lashing bridges between
# saturated like the reference (blues, magenta/pink, violet, red, orange, the odd white/green)
PALETTE = ['#2a6fd6', '#e2508f', '#6a2bd8', '#d8342c', '#ff7a2a', '#1c3fae', '#c2185b', '#3022c9', '#1f8a3a', '#f0f0f0', '#4fa3f0', '#ff4f6a']
if MESHY:      # measured off the reference: navy, red, mid blue, orange-red, pale grey, green, pink, ochre
    PALETTE = ['#0a0c8c', '#ff2a20', '#2a86f5', '#ff5a26', '#dcdcdc', '#1f9a3a', '#f2479f', '#e8a836', '#2a86f5', '#ff2a20']
roofs = [roof_mat(f'roof{i}', c) for i, c in enumerate(PALETTE)]
# the truck's light-grey box stays on screen as the ship slides up under it: the centre column of
# the bays that pass beneath it is the same grey, so the box seems to land on the ship (reference)
truck_box = roof_mat('roof_truckbox', '#c4c9cf')
TRUCK_COL, TRUCK_BAYS = 2, (0, 1, 2, 3)
# scanned ship: a mixed load like the reference's (palette index per column, bays from the bow)
GRID = [(7, 3, 4, 0, 5), (0, 6, 4, 1, 2), (2, 1, 4, 3, 7), (5, 0, 4, 2, 1), (0, 1, 2, 3, 6)]
BAY_LEN, BRIDGE = 12.19, 2.3 if MESHY else 2.4         # reference: ~2.4 m lashing-bridge strip between bays
COLS = 5
TIER = 2.59


# the top tier of every stack is the same 40 ft container model the truck carries (Sketchfab, CC BY,
# see CREDITS.md), tinted per box; the tiers under it are plain boxes in the same colour
def load_container():
    path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'models', 'container.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    src = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
    me = src.data.copy()
    me.transform(src.matrix_world)
    # model: length along X, origin bottom centre (12.07 x 2.43 x 2.92) -> one bay: 2.44 x 12.19 x 2.59, length along Y
    me.transform(__import__('mathutils').Matrix.Rotation(math.pi / 2, 4, 'Z'))
    me.transform(__import__('mathutils').Matrix.Diagonal((2.44 / 2.426, BAY_LEN / 12.066, TIER / 2.924, 1)))
    for o in [o for o in bpy.data.objects if o not in before]:
        bpy.data.objects.remove(o, do_unlink=True)
    return me


def tinted(base, name, color, linear=None):
    """Copy of the container material with its (light grey) paint multiplied by `color`."""
    m = base.copy()
    m.name = name
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    link = next(lk for lk in nt.links if lk.to_socket == b.inputs['Base Color'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    rgba = lambda socks, n: next(sk for sk in socks if sk.name == n and sk.type == 'RGBA')
    mix.inputs['Factor'].default_value = 1.0
    rgba(mix.inputs, 'B').default_value = (*(linear or srgb(color)), 1)
    nt.links.new(link.from_socket, rgba(mix.inputs, 'A'))
    nt.links.new(rgba(mix.outputs, 'Result'), b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.7          # matt paint from above, like the plain tiers
    return m


cont_mesh = load_container()
cont_base = cont_mesh.materials[0]
# the grey texture reads ~0.8 bright: lift the tint so a tinted box comes out at the palette colour
lift = lambda c: '#%02x%02x%02x' % tuple(min(255, round(int(c[i:i + 2], 16) * 1.04)) for i in (1, 3, 5))   # saturated, like the reference
cont_tints = [tinted(cont_base, f'cont{i}', lift(c)) for i, c in enumerate(PALETTE)]
# the truck's box on the page reads (190,192,194) from above; under this sun the untinted texture
# came out (167,163,157): lifted and cooled (linear gains) so the hand-over matches
cont_truck = tinted(cont_base, 'cont_truckbox', None, linear=(1.22, 1.32, 1.47))


def top_box(name, x, yc, z0, m_):
    o = bpy.data.objects.new(name, cont_mesh)
    s.collection.objects.link(o)
    o.parent = ship
    o.location = (x, yc, z0)
    o.material_slots[0].link = 'OBJECT'
    o.material_slots[0].material = m_
    return o


# scanned hull (Meshy, from our own plan render): model x runs bow -> stern, deck at z = -0.129, its
# five fused container blocks start at these x; they are cut out and our own boxes stand in their place
# the reference measures 21 m beam for 2.44 m boxes at a 3.03 m pitch and 14.5 m from bay to bay, so
# the model is scaled per axis; its flat foredeck strip (M_FA..M_FB) is stretched to seat a 3-box bow bay
M_SX, M_SY, M_SZ, M_OFF, M_DECK = 60.2, 48.8, 55.0, 4.5, -0.129
M_BLOCKS = [(-0.607, -0.385), (-0.365, -0.145), (-0.125, 0.097), (0.117, 0.337), (0.357, 0.557)]
M_FA, M_FB = -0.71, -0.615
M_K = (BRIDGE + BAY_LEN + 1.2) / ((M_FB - M_FA) * M_SX)


def m_x(x):
    # model x after the foredeck stretch
    if x >= M_FB:
        return x
    return M_FB + (max(x, M_FA) - M_FB) * M_K + min(x - M_FA, 0.0)


m_Y = lambda x: m_x(x) * M_SX + M_OFF
if MESHY:
    BAY_Y = [(a + b) / 2 * M_SX + M_OFF - BAY_LEN / 2 for a, b in M_BLOCKS[:4]] + [M_BLOCKS[4][0] * M_SX + M_OFF + 0.5]
else:
    BAY_Y = [-40.0 + i * (BAY_LEN + BRIDGE) for i in range(6)]
NBAY = len(BAY_Y)
BOW_TOP = BAY_Y[0] - BRIDGE + 0.05              # scanned ship: the bow photo starts here (row 0), tip 26.1 m ahead
BOW_Y = BOW_TOP - 26.1 if MESHY else -58.0
for bay in range(NBAY):
    y = BAY_Y[bay]                         # bays from behind the forecastle up to the accommodation
    yc = y + BAY_LEN / 2
    tiers_base = 2 if MESHY else 4                            # every stack the same height: one flat, orderly layer from above (reference)
    for c in range(COLS):
        x = (c - (COLS - 1) / 2) * PITCH
        tiers = tiers_base
        if c == TRUCK_COL and bay in TRUCK_BAYS:
            tiers = tiers_base
        h = tiers * TIER
        k = GRID[bay][c] if MESHY else rnd.randrange(len(roofs))
        m_, top_m = roofs[k], cont_tints[k]
        if c == TRUCK_COL and bay in TRUCK_BAYS:
            m_, top_m = truck_box, cont_truck
        lower = h - TIER
        box(f'stack{bay}_{c}', (2.42, BAY_LEN - 0.02, lower), (x, yc, DECK + 0.3 + lower / 2), m_, bevel=0.04, segments=1, parent=ship)
        top_box(f'top{bay}_{c}', x, yc, DECK + 0.3 + lower, top_m)
    # hatch coaming under the stacks
    box(f'coaming{bay}', (COLS * PITCH + 0.8, BAY_LEN + (1.3 if MESHY else 0.6), 0.6), (0, yc, DECK + 0.3), hatch_m, bevel=0.05, parent=ship)
    box(f'hatchseam{bay}', (COLS * PITCH + 0.82, 0.06, 0.02), (0, yc, DECK + 0.61), dark, parent=ship)
    # lashing bridge between bays (reference): a low blue steel walkway across the hold, the same
    # blue as the deck, with pale steel fittings at both ends and a thin handrail
    yb = (y + BAY_LEN + BAY_Y[bay + 1]) / 2 if MESHY and bay < NBAY - 1 else y + BAY_LEN + BRIDGE / 2
    if bay < NBAY - 1:
        W = 2 * HALF - 1.6
        box(f'lash{bay}', (W, BRIDGE + 0.5 if MESHY else 2.1, 1.2), (0, yb, DECK + 0.6), grey, bevel=0.05, parent=ship)
        for sgn in (-1, 1):
            box(f'lash_rail{bay}{sgn}', (W, 0.04, 0.04), (0, yb + sgn * 1.0, DECK + 1.75), rail_m, parent=ship)
            for k in range(COLS + 1):
                box(f'lash_post{bay}{sgn}{k}', (0.05, 0.05, 0.55), ((k - COLS / 2) * PITCH, yb + sgn * 1.0, DECK + 1.48), rail_m, parent=ship)
            for j in (-0.32, 0.32):                              # end fittings (pale steel brackets)
                box(f'lash_fit{bay}{sgn}{j}', (1.5, 0.22, 0.25), (sgn * (W / 2 - 0.9), yb + j, DECK + 1.3), steel_m, bevel=0.03, parent=ship)
        for k in range(COLS):                                    # lashing cones at each column end
            box(f'lash_cone{bay}{k}', (0.35, 0.3, 0.25), ((k - (COLS - 1) / 2) * PITCH, yb, DECK + 1.32), steel_m, parent=ship)

# ship's sides (reference): dark hull band at the very edge, a pale rail on top of it with a row of
# small white stanchions, a narrow blue-grey walkway inside, the hatch coamings' pale inner edge
for sgn in (-1, 1):
    box(f'gangway{sgn}', (1.2, 96, 0.45), (sgn * (HALF - 0.95), 4, DECK + 0.28), gunwale_m, bevel=0.03, parent=ship)
    box(f'bulwark{sgn}', (0.3, 96, 0.9), (sgn * (HALF - 0.18), 4, DECK + 0.5), hull_m, bevel=0.04, parent=ship)
    box(f'siderail{sgn}', (0.06, 96, 0.06), (sgn * (HALF - 0.18), 4, DECK + 1.05), white, parent=ship)
    box(f'coam_edge{sgn}', (0.08, 90, 0.06), (sgn * (COLS * PITCH / 2 + 0.45), 3, DECK + 0.62), rail_m, parent=ship)
    for k in range(80):
        box(f'stanchion{sgn}{k}', (0.06, 0.06, 0.55), (sgn * (HALF - 0.18), -43 + k * 1.2, DECK + 0.95), white, parent=ship)
    yy = -40.0 + BAY_LEN
    for b in range(5):
        box(f'sidefit{sgn}{b}', (1.0, 1.6, 0.4), (sgn * (HALF - 0.95), yy + BRIDGE / 2, DECK + 0.68), steel_m, bevel=0.04, parent=ship)
        yy += BAY_LEN + BRIDGE

# bow (rounded, at the bottom): white breakwater bar across the deck on posts, mast, winches,
# bollards, as the reference
box('breakwater', (2 * HALF - 2.2, 0.6, 1.0), (0, -44.0, DECK + 1.6), white, bevel=0.05, parent=ship)
for k in range(13):
    box(f'bw_post{k}', (0.12, 0.7, 1.3), (-HALF + 1.6 + k * (2 * HALF - 3.2) / 12, -43.5, DECK + 0.9), white, parent=ship)
for sgn in (-1, 1):
    cylinder(f'winch{sgn}', 0.8, 1.6, (sgn * 3.0, -48.5, DECK + 1.2), steel_m, axis='X', parent=ship)
    for yy in (-46, -50.5, -54):
        cylinder(f'bollard{sgn}{yy}', 0.25, 0.6, (sgn * (HALF * (0.9 if yy > -50 else 0.6) - 1.2), yy, DECK + 0.6), steel_m, axis='Z', parent=ship)
cylinder('foremast', 0.25, 7, (0, -49.0, DECK + 4.5), white, axis='Z', parent=ship)
box('foremast_x', (2.6, 0.25, 0.25), (0, -49.0, DECK + 7.2), white, parent=ship)

# stern (top), as the reference seen from above: the accommodation steps up in three blue-roofed
# tiers, every roof edged with a white rail; thin white bridge wings run the full beam in front;
# a white mast with cross-trees and two radomes on top, the funnel a dark opening behind it
def tier(name, w, d, yy, z0, h):
    box(f'{name}_wall', (w, d, h), (0, yy, DECK + z0 + h / 2), white, bevel=0.06, parent=ship)
    box(f'{name}_roof', (w - 0.2, d - 0.2, 0.06), (0, yy, DECK + z0 + h + 0.02), deck_m, parent=ship)
    for sgn in (-1, 1):
        box(f'{name}_rx{sgn}', (w, 0.12, 0.12), (0, yy + sgn * (d / 2 - 0.06), DECK + z0 + h + 0.1), white, parent=ship)
        box(f'{name}_ry{sgn}', (0.12, d, 0.12), (sgn * (w / 2 - 0.06), yy, DECK + z0 + h + 0.1), white, parent=ship)


tier('acc1', 2 * HALF - 3.0, 9.0, 53.3, 0.0, 9.0)
tier('acc2', 12.0, 7.0, 53.8, 9.0, 5.0)
tier('acc3', 7.0, 4.6, 54.0, 14.0, 2.6)
box('wings', (2 * HALF + 1.4, 1.3, 0.4), (0, 49.6, DECK + 13.8), white, bevel=0.08, parent=ship)
box('wings_win', (2 * HALF + 1.4, 0.06, 0.35), (0, 48.95, DECK + 13.7), window, parent=ship)
box('mast', (0.35, 0.35, 4.5), (0, 54.0, DECK + 18.8), white, parent=ship)
box('mast_x', (4.6, 0.3, 0.25), (0, 54.0, DECK + 20.4), white, parent=ship)
box('mast_x2', (2.6, 0.3, 0.25), (0, 54.6, DECK + 19.6), white, parent=ship)
for sgn in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.75, location=(sgn * 2.6, 52.6, DECK + 17.1))
    dome = bpy.context.object
    dome.data.materials.append(white)
    dome.parent = ship
    box(f'radar_arm{sgn}', (1.8, 0.2, 0.15), (sgn * 1.3, 53.2, DECK + 17.3), white, parent=ship)
box('funnel_casing', (4.6, 3.8, 15.2), (0, 58.0, DECK + 7.6), deck_m, bevel=0.1, parent=ship)
box('funnel_mouth', (3.4, 2.8, 0.1), (0, 58.0, DECK + 15.25), dark, parent=ship)
box('lifeboat', (1.8, 5.0, 1.6), (HALF - 1.8, 55.5, DECK + 6.5), orange, bevel=0.7, parent=ship)
box('stern_deck', (2 * HALF - 1.2, 2.6, 0.3), (0, 59.6, DECK + 0.2), deck_m, bevel=0.05, parent=ship)
for sgn in (-1, 1):
    cylinder(f'stern_winch{sgn}', 0.6, 1.2, (sgn * 3.5, 59.8, DECK + 0.9), steel_m, axis='X', parent=ship)



def load_meshy_ship():
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '_export', 'meshy_ship_v2.glb'))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    o = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
    bm = bmesh.new()
    bm.from_mesh(o.data)
    kill = [v for v in bm.verts if abs(v.co.y) < 0.136 and v.co.z > M_DECK + 0.002
            and M_BLOCKS[0][0] - 0.002 < v.co.x < M_BLOCKS[4][1] + 0.002]      # blocks and the smeared strips between them
    # foredeck strip: the bar and anything else standing on it goes, the bow bay stands there instead
    kill += [v for v in bm.verts if abs(v.co.y) < 0.15 and v.co.z > -0.095 and M_FA < v.co.x < M_FB - 0.004]
    # the scan's accommodation is a smear from above: it goes too, ours (clean tiers, below) stands there
    kill += [v for v in bm.verts if v.co.x > M_BLOCKS[4][1] and (v.co.z > -0.095 or (abs(v.co.y) < 0.2 and v.co.z > M_DECK - 0.004))]
    bmesh.ops.delete(bm, geom=list(set(kill)), context='VERTS')
    for v in bm.verts:
        v.co.x = m_x(v.co.x)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x * M_SX + M_OFF < BOW_TOP], context='VERTS')   # the scan's bow: replaced by the photo
    bm.to_mesh(o.data)
    bm.free()
    o.parent = ship
    o.rotation_mode = 'XYZ'
    o.rotation_euler = (0, 0, math.pi / 2)       # model +x (stern) -> +Y, up the screen
    o.scale = (M_SX, M_SY, M_SZ)
    o.location = (0, M_OFF, DECK - M_DECK * M_SZ)
    o.name = 'meshy_hull'
    # paint: the scan's blue is lighter and more violet than the reference deck (22,93,148), and its
    # hull rim is white where the reference is dark blue
    nt = o.data.materials[0].node_tree
    b = nt.nodes['Principled BSDF']
    link = next(lk for lk in nt.links if lk.to_socket == b.inputs['Base Color'])
    hsv = node(nt, 'ShaderNodeHueSaturation', Hue=HULL_HSV[0], Saturation=HULL_HSV[1], Value=HULL_HSV[2])
    nt.links.new(link.from_socket, hsv.inputs['Color'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    ab = nt.nodes.new('ShaderNodeMath')
    ab.operation = 'ABSOLUTE'
    nt.links.new(sep.outputs['Y'], ab.inputs[0])
    edge = nt.nodes.new('ShaderNodeMath')
    edge.operation = 'GREATER_THAN'
    edge.inputs[1].default_value = RIM_Y
    nt.links.new(ab.outputs[0], edge.inputs[0])
    low = nt.nodes.new('ShaderNodeMath')
    low.operation = 'LESS_THAN'
    low.inputs[1].default_value = -0.055
    nt.links.new(sep.outputs['Z'], low.inputs[0])
    mask = nt.nodes.new('ShaderNodeMath')
    mask.operation = 'MULTIPLY'
    nt.links.new(edge.outputs[0], mask.inputs[0])
    nt.links.new(low.outputs[0], mask.inputs[1])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    rgba = lambda socks, n: next(sk for sk in socks if sk.name == n and sk.type == 'RGBA')
    nt.links.new(mask.outputs[0], mix.inputs['Factor'])
    # only the blue paint is shifted: whites, the orange boats and the grey fittings keep their colour
    rgb = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(link.from_socket, rgb.inputs['Color'])
    bl = nt.nodes.new('ShaderNodeMath')
    bl.operation = 'SUBTRACT'
    nt.links.new(rgb.outputs['Blue'], bl.inputs[0])
    nt.links.new(rgb.outputs['Red'], bl.inputs[1])
    blf = nt.nodes.new('ShaderNodeMath')
    blf.operation = 'MULTIPLY'
    blf.use_clamp = True
    blf.inputs[1].default_value = 6.0
    nt.links.new(bl.outputs[0], blf.inputs[0])
    paint = nt.nodes.new('ShaderNodeMix')
    paint.data_type = 'RGBA'
    nt.links.new(blf.outputs[0], paint.inputs['Factor'])
    nt.links.new(link.from_socket, rgba(paint.inputs, 'A'))
    nt.links.new(hsv.outputs['Color'], rgba(paint.inputs, 'B'))
    nt.links.new(rgba(paint.outputs, 'Result'), rgba(mix.inputs, 'A'))
    rgba(mix.inputs, 'B').default_value = (*srgb(RIM_COL), 1)
    # the scan also painted the coaming edges, side rails and bow rim white: along the cargo deck and
    # round the bow tip anything pale at deck level becomes deck blue (mast and winches sit inboard)
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

    X, Z = sep.outputs['X'], sep.outputs['Z']
    where = mth('MAXIMUM', mth('GREATER_THAN', ab.outputs[0], 0.13), mth('LESS_THAN', X, -0.97))
    where = mth('MULTIPLY', where, mth('LESS_THAN', Z, -0.055))
    pale = mth('MULTIPLY', where, mth('GREATER_THAN', rgb.outputs['Green'], PALE_G))
    mix2 = nt.nodes.new('ShaderNodeMix')
    mix2.data_type = 'RGBA'
    nt.links.new(pale, mix2.inputs['Factor'])
    nt.links.new(rgba(mix.outputs, 'Result'), rgba(mix2.inputs, 'A'))
    rgba(mix2.inputs, 'B').default_value = (*srgb('#0b3f69'), 1)
    # accommodation (reference): blue roofs; only the bridge-wing band across the front and the mast
    # stay white. The scan's shading is kept as lighter and darker blue so the decks still read
    G_, B_ = rgb.outputs['Green'], rgb.outputs['Blue']
    acc = mth('MULTIPLY', mth('GREATER_THAN', X, ACC_X), mth('LESS_THAN', Z, ACC_Z))
    acc = mth('MULTIPLY', acc, mth('MULTIPLY', mth('GREATER_THAN', G_, PALE_G), mth('GREATER_THAN', B_, 0.25)))
    tone = nt.nodes.new('ShaderNodeMix')
    tone.data_type = 'RGBA'
    nt.links.new(mth('SUBTRACT', G_, PALE_G), tone.inputs['Factor'])
    rgba(tone.inputs, 'A').default_value = (*srgb('#0b3f69'), 1)
    rgba(tone.inputs, 'B').default_value = (*srgb('#2a7fc0'), 1)
    mix3 = nt.nodes.new('ShaderNodeMix')
    mix3.data_type = 'RGBA'
    nt.links.new(acc, mix3.inputs['Factor'])
    nt.links.new(rgba(mix2.outputs, 'Result'), rgba(mix3.inputs, 'A'))
    nt.links.new(rgba(tone.outputs, 'Result'), rgba(mix3.inputs, 'B'))
    nt.links.new(rgba(mix3.outputs, 'Result'), b.inputs['Base Color'])
    for name, val in (('Roughness', 0.6), ('Metallic', 0.0)):     # matt from above: no sky sheen washing the paint out
        sock = b.inputs[name]
        if sock.is_linked:
            nt.links.remove(sock.links[0])
        sock.default_value = val
    return o


PALE_G = 0.2
ACC_GAIN = 1.19
ACC_X, ACC_Z = 0.59, 0.21
HULL_HSV, RIM_Y, RIM_COL = (0.48, 1.12, 0.8), 0.183, '#0b3d63'
if MESHY:
    keep = ('stack', 'top', 'coaming', 'hatchseam', 'lash', 'side_')
    Y_ACC = M_BLOCKS[4][1] * M_SX + M_OFF           # front of the accommodation, right behind bay 5
    for o in list(ship.children_recursive):
        if not o.name.startswith(keep):
            bpy.data.objects.remove(o, do_unlink=True)
    box('stern_plate', (2 * 0.2 * M_SY, m_Y(0.94) - Y_ACC + 1.0, 0.3), (0, (m_Y(0.94) + Y_ACC) / 2 - 0.5, DECK - 0.1), hatch_m, bevel=0.05, parent=ship)

    # accommodation as the reference shows it from above (u across, v metres aft of bay 5): stepped
    # blue roofs each edged in white, a white bridge house and wing band across the front, the mast
    # cross and two radomes on the middle roof, the funnel a dark opening aft, deck gear around it
    brown = mat('acc_brown', '#8a735e', rough=0.7)
    green = mat('acc_green', '#2f5a3a', rough=0.7)

    def worn(name, color, lo=0.82, scale=0.6):
        """Painted steel seen from above: patchy wear and fine speckle instead of one flat colour."""
        m = mat(name, color, metal=0.0, rough=0.7)
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        tc = nt.nodes.new('ShaderNodeTexCoord')
        big = node(nt, 'ShaderNodeTexNoise', Scale=scale, Detail=6.0, Roughness=0.65)
        fine = node(nt, 'ShaderNodeTexNoise', Scale=scale * 14, Detail=2.0, Roughness=0.5)
        for n in (big, fine):
            nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
        add = nt.nodes.new('ShaderNodeMath')
        add.operation = 'ADD'
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = 0.35
        nt.links.new(fine.outputs['Fac'], mul.inputs[0])
        nt.links.new(big.outputs['Fac'], add.inputs[0])
        nt.links.new(mul.outputs[0], add.inputs[1])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[1].position = 0.85
        ramp.color_ramp.elements[0].color = (*[c * lo for c in srgb(color)], 1)
        ramp.color_ramp.elements[1].color = (*[min(1.0, c * 1.12) for c in srgb(color)], 1)
        nt.links.new(add.outputs[0], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
        return m

    roof_blue = worn('acc_roof', '#0f4f80')
    paint_w = worn('acc_white', '#e4e7ea', lo=0.9, scale=0.9)
    pipe_m = mat('acc_pipe', '#8d99a6', metal=0.0, rough=0.6)
    rope_m = mat('acc_rope', '#b79a6a', rough=0.9)
    A = lambda u, v, z: (u, Y_ACC + v, DECK + z)

    def roofed(name, right, z0, z1, rim=0.2):
        """White-walled tier from a half outline (right side, front to aft), blue roof inside a white rim."""
        pts = [(u, Y_ACC + v) for u, v in right] + [(-u, Y_ACC + v) for u, v in reversed(right)]
        prism(f'{name}_wall', pts, DECK + z0, DECK + z1, paint_w, bevel=0.05, parent=ship)
        cy = sum(y_ for _, y_ in pts) / len(pts)
        w = max(u for u, _ in right)
        d = max(v for _, v in right) - min(v for _, v in right)
        inner = [(x_ * (1 - rim / w), cy + (y_ - cy) * (1 - 2 * rim / d)) for x_, y_ in pts]
        prism(f'{name}_roof', inner, DECK + z1 - 0.05, DECK + z1 + 0.06, roof_blue, bevel=0.0, parent=ship)

    roofed('accA', [(9.7, 4.6), (9.7, 9.6), (8.0, 9.6), (8.0, 13.4), (5.9, 13.4), (5.9, 19.2)], 0.0, 9.0)
    roofed('accB', [(4.4, 5.0), (5.6, 6.6), (5.6, 13.0)], 9.0, 14.0)
    roofed('accC', [(2.3, 6.9), (3.2, 7.9), (3.2, 11.2)], 14.0, 16.6, rim=0.16)
    # bridge front: wing band over the full beam and the white bridge-house roof with its window dots
    box('wings', (2 * HALF + 1.0, 1.4, 0.4), A(0, 2.0, 13.9), paint_w, bevel=0.08, parent=ship)
    box('bridge_roof', (16.4, 2.6, 0.4), A(0, 3.5, 14.3), paint_w, bevel=0.1, parent=ship)
    for k in range(7):                                   # roof plating seams
        box(f'bridge_seam{k}', (0.04, 2.4, 0.02), A(-6.6 + k * 2.2, 3.7, 14.51), pipe_m, bevel=0.0, parent=ship)
    for k, (u, v, w, d) in enumerate([(-4.6, 4.2, 1.2, 0.8), (3.9, 4.4, 0.9, 0.9), (0.6, 4.5, 0.5, 0.5), (-1.8, 3.2, 0.7, 0.4)]):
        box(f'bridge_box{k}', (w, d, 0.5), A(u, v, 14.7), pipe_m, bevel=0.05, parent=ship)
    for k in range(7):
        box(f'bridge_win{k}', (0.9, 0.2, 0.05), A(-4.5 + k * 1.5, 2.45, 14.52), window, bevel=0.0, parent=ship)
    for sgn in (-1, 1):
        box(f'wing_end{sgn}', (1.6, 2.6, 0.5), A(sgn * (HALF - 0.3), 2.3, 13.7), white, bevel=0.08, parent=ship)
    # mast cross with stays, radomes
    box('mast', (0.4, 5.2, 0.4), A(0, 8.6, 20.2), white, parent=ship)
    box('mast_x', (4.8, 0.36, 0.3), A(0, 8.0, 20.4), white, parent=ship)
    box('mast_x2', (2.6, 0.3, 0.25), A(0, 9.6, 19.8), white, parent=ship)
    for sgn in (-1, 1):
        box(f'mast_d{sgn}', (0.22, 3.4, 0.2), A(sgn * 1.0, 7.4, 19.6), white, rot=(0, 0, sgn * 0.6), parent=ship)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.8, location=A(sgn * 4.3, 6.4, 14.7))
        dome = bpy.context.object
        dome.name = f'radome{sgn}'
        dome.data.materials.append(white)
        dome.parent = ship
        for o_ in dome.data.polygons:
            o_.use_smooth = True
    # funnel and the gear on the lower deck around it
    box('funnel_casing', (5.4, 4.6, 15.4), A(0, 16.0, 7.7), deck_m, bevel=0.1, parent=ship)
    box('funnel_rim', (4.6, 3.9, 0.12), A(0, 16.0, 15.42), white, bevel=0.0, parent=ship)
    box('funnel_mouth', (4.2, 3.5, 0.14), A(0, 16.0, 15.46), dark, bevel=0.0, parent=ship)
    box('cabin_red', (2.9, 2.5, 2.4), A(-3.9, 17.6, 10.2), red, bevel=0.06, parent=ship)
    box('cabin_red_rim', (3.2, 2.8, 0.1), A(-3.9, 17.6, 9.06), white, bevel=0.0, parent=ship)
    box('locker_green', (1.3, 3.4, 1.4), A(-7.0, 11.4, 9.7), green, bevel=0.05, parent=ship)
    box('gear_brown', (2.2, 2.6, 0.5), A(4.3, 17.2, 9.3), brown, bevel=0.05, parent=ship)
    box('gear_brown2', (1.6, 1.4, 0.9), A(7.0, 11.2, 9.5), brown, bevel=0.05, parent=ship)
    cylinder('tank_w', 0.9, 1.2, A(7.1, 15.4, 0.9), white, axis='Z', parent=ship)
    box('lifeboat', (1.7, 3.6, 1.5), A(8.9, 11.6, 9.9), orange, bevel=0.6, parent=ship)
    box('lifeboat_cradle', (2.3, 4.4, 0.12), A(8.9, 11.6, 9.08), white, bevel=0.0, parent=ship)
    for k, (u, v) in enumerate([(-2.6, 13.9), (2.9, 14.2), (-5.0, 15.6), (1.9, 18.6), (-1.2, 18.9), (-8.6, 7.4), (8.7, 6.6)]):
        box(f'vent{k}', (0.6, 0.6, 0.7), A(u, v, 9.4), white, bevel=0.1, parent=ship)
    # the small stuff that makes it read as a working ship (reference): stairs between the decks,
    # life-raft canisters, pipe runs, antennas, hatches, coiled mooring rope
    def stairs(name, u, v, w, d, z, along='v', n=7):
        box(f'{name}_bed', (w, d, 0.06), A(u, v, z), pipe_m, bevel=0.0, parent=ship)
        for k in range(n):
            t = (k + 0.5) / n - 0.5
            if along == 'v':
                box(f'{name}_{k}', (w * 0.9, 0.07, 0.05), A(u, v + t * d, z + 0.06), paint_w, bevel=0.0, parent=ship)
            else:
                box(f'{name}_{k}', (0.07, d * 0.9, 0.05), A(u + t * w, v, z + 0.06), paint_w, bevel=0.0, parent=ship)

    stairs('stairA', -6.6, 14.6, 0.9, 2.4, 9.1)
    stairs('stairB', 6.5, 8.2, 0.9, 2.2, 9.1)
    stairs('stairC', -4.9, 9.4, 2.0, 0.9, 14.1, along='u')
    stairs('stairD', 8.7, 14.6, 0.9, 2.6, 0.5)
    stairs('stairE', -8.7, 14.2, 0.9, 2.6, 0.5)
    for k, (u, v) in enumerate([(-8.9, 5.4), (-8.9, 6.3), (8.9, 8.6), (8.9, 9.4), (-7.2, 8.4), (-4.9, 11.9), (4.9, 11.6), (4.9, 12.3)]):
        cylinder(f'raft{k}', 0.32, 1.1, A(u, v, 9.4 if abs(u) > 5.7 else 14.4), paint_w, axis='X', parent=ship)
    for k, (u, v0, v1, z) in enumerate([(-1.6, 11.6, 13.6, 14.2), (1.2, 12.0, 13.6, 14.2), (-7.4, 5.2, 9.2, 9.2), (7.6, 5.0, 7.6, 9.2), (-2.9, 13.6, 19.0, 9.2), (2.2, 18.4, 19.0, 9.2)]):
        box(f'pipe_v{k}', (0.09, v1 - v0, 0.09), A(u, (v0 + v1) / 2, z), pipe_m, bevel=0.0, parent=ship)
    for k, (u0, u1, v, z) in enumerate([(-5.4, -1.6, 12.4, 14.2), (1.2, 5.2, 12.0, 14.2), (-5.6, 5.6, 18.9, 9.2), (-9.4, -6.2, 9.9, 9.2)]):
        box(f'pipe_u{k}', (u1 - u0, 0.09, 0.09), A((u0 + u1) / 2, v, z), pipe_m, bevel=0.0, parent=ship)
    for k, (u, v, z) in enumerate([(-2.6, 7.4, 16.8), (2.7, 9.8, 16.8), (-3.9, 10.6, 14.2), (4.6, 8.6, 14.2), (0.0, 12.2, 14.2)]):
        cylinder(f'antenna{k}', 0.05, 2.4, A(u, v, z + 1.2), paint_w, axis='Z', parent=ship)
        cylinder(f'antenna_foot{k}', 0.22, 0.2, A(u, v, z + 0.1), pipe_m, axis='Z', parent=ship)
    for k, (u, v, z) in enumerate([(-7.1, 17.4, 0.1), (7.3, 18.2, 0.1), (-3.6, 10.2, 14.1), (2.1, 5.9, 14.1), (-6.9, 6.4, 9.1), (6.6, 12.9, 9.1)]):
        box(f'hatch_sq{k}', (0.9, 0.9, 0.1), A(u, v, z), pipe_m, bevel=0.03, parent=ship)
    for k, (u, v) in enumerate([(-6.2, 21.9), (6.3, 21.4), (-0.4, 22.3)]):
        cylinder(f'rope{k}', 0.5, 0.25, A(u, v, 0.2), rope_m, axis='Z', parent=ship)
        cylinder(f'rope_in{k}', 0.22, 0.27, A(u, v, 0.2), hatch_m, axis='Z', parent=ship)
    # aft deck: rail across, two winches, bollards
    box('aft_rail', (17.5, 0.08, 0.08), A(0, 19.9, 1.1), paint_w, parent=ship)
    for sgn in (-1, 1):
        cylinder(f'stern_winch{sgn}', 0.6, 1.3, A(sgn * 3.4, 21.6, 0.9), steel_m, axis='X', parent=ship)
        box(f'stern_winch_bed{sgn}', (2.2, 1.8, 0.2), A(sgn * 3.4, 21.6, 0.2), grate, bevel=0.03, parent=ship)
        for v in (20.8, 22.4):
            cylinder(f'stern_bollard{sgn}{v}', 0.25, 0.6, A(sgn * 7.6, v, 0.5), steel_m, axis='Z', parent=ship)
    hull_o = load_meshy_ship()
    # ship's sides along the cargo deck (reference): pale rail on small posts at the hull edge, pale
    # steel brackets where each lashing bridge lands, and a bridge ahead of bay 1 as well
    rail_w = mat('side_rail', '#8799a8', rough=0.7)
    band_m = mat('side_band', '#255f8a', rough=0.7)             # weathered grating along the edge
    fit_m = mat('side_fit', '#7f8a92', rough=0.8)               # pale steel gone a little rusty
    rib_m = mat('side_rib', '#2f76a8', rough=0.7)
    ya, yz = BAY_Y[0] - 1.0, BAY_Y[-1] + BAY_LEN + 0.8
    for sgn in (-1, 1):
        box(f'side_rail{sgn}', (0.07, yz - ya, 0.07), (sgn * (HALF - 0.35), (ya + yz) / 2, DECK + 1.9), rail_w, bevel=0.0, parent=ship)
        box(f'side_rail_in{sgn}', (0.05, yz - ya, 0.05), (sgn * (COLS * PITCH / 2 + 0.75), (ya + yz) / 2, DECK + 0.75), rail_m, bevel=0.0, parent=ship)
        box(f'side_band{sgn}', (0.5, yz - ya, 0.05), (sgn * (HALF - 0.62), (ya + yz) / 2, DECK + 1.75), band_m, bevel=0.0, parent=ship)
        for k in range(int((yz - ya) / 1.5) + 1):
            box(f'side_post{sgn}{k}', (0.09, 0.09, 0.5), (sgn * (HALF - 0.35), ya + k * 1.5, DECK + 1.7), rail_w, bevel=0.0, parent=ship)
        for k in range(int((yz - ya) / 6.1) + 1):                # angled stays from the rail in to the coaming
            for j, a_ in ((-0.5, 0.5), (0.5, -0.5)):
                box(f'side_stay{sgn}{k}{j}', (1.5, 0.14, 0.14), (sgn * (HALF - 1.2), ya + 3.0 + k * 6.1 + j, DECK + 1.6), fit_m, bevel=0.0, rot=(0, 0, sgn * a_), parent=ship)
        for b_ in range(NBAY):
            yg = BAY_Y[b_] - BRIDGE / 2 + 0.3
            for j in (-0.55, 0.55):
                box(f'side_fit{sgn}{b_}{j}', (1.7, 0.2, 0.3), (sgn * (HALF - 1.5), yg + j, DECK + 1.35), fit_m, bevel=0.03, parent=ship)
            box(f'side_fitx{sgn}{b_}', (0.2, 1.3, 0.3), (sgn * (HALF - 0.75), yg, DECK + 1.35), fit_m, bevel=0.03, parent=ship)
    yg = BAY_Y[0] - BRIDGE / 2 + 0.3
    box('lash_bow', (2 * HALF - 1.6, BRIDGE + 0.5, 1.2), (0, yg, DECK + 0.6), grey, bevel=0.05, parent=ship)
    for k in range(COLS):
        box(f'lash_cone_bow{k}', (0.35, 0.3, 0.25), ((k - (COLS - 1) / 2) * PITCH, yg, DECK + 1.32), steel_m, parent=ship)
    # bow (reference): flared shoulders, ribbed bulwark, breakwater, foremast, windlasses. Like the
    # accommodation it is a straight-down photoreal picture (made from our own drawing of the measured
    # outline) laid flat; our own three boxes stand on its hatch cover
    def photo_plane(name, file, px, cx, y_row0, z):
        x0, x1 = (0 - cx) / px, (1024 - cx) / px
        y0, y1 = y_row0 - 1024 / px, y_row0
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        f = bm.faces.new([bm.verts.new((x, yy, z)) for x, yy in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))])
        for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            lp[uvl].uv = uv
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        s.collection.objects.link(o)
        o.parent = ship
        pm = bpy.data.materials.new(name)
        pm.use_nodes = True
        nt = pm.node_tree
        nt.nodes.remove(nt.nodes['Principled BSDF'])
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '_export', file)))
        tex.extension = 'CLIP'
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Strength'].default_value = ACC_GAIN      # a photo, not paint under our sun: shown as it is
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(tex.outputs['Color'], em.inputs['Color'])
        nt.links.new(tex.outputs['Alpha'], mx.inputs['Fac'])
        nt.links.new(tr.outputs['BSDF'], mx.inputs[1])
        nt.links.new(em.outputs['Emission'], mx.inputs[2])
        nt.links.new(mx.outputs['Shader'], nt.nodes['Material Output'].inputs['Surface'])
        me.materials.append(pm)
        return o

    photo_plane('photo_bow', 'ship_bow_rgba.png', 38.67, 511.5, BOW_TOP, DECK + 0.2)
    yb0 = BOW_TOP - 6.94 - BAY_LEN / 2                # centred on the photo's hatch cover
    for c in range(3):
        k = (2, 1, 6)[c]
        box(f'stackbow_{c}', (2.42, BAY_LEN - 0.02, TIER), ((c - 1) * PITCH, yb0 + BAY_LEN / 2, DECK + 0.3 + TIER / 2), roofs[k], bevel=0.04, segments=1, parent=ship)
        top_box(f'topbow_{c}', (c - 1) * PITCH, yb0 + BAY_LEN / 2, DECK + 0.3 + TIER, cont_tints[k])


if MESHY:
    # The accommodation itself is a straight-down photoreal picture laid flat on the stern, the way the
    # reference shows its ship (image made for us from our own layout drawing; hull cut out, blue matched).
    # The camera only ever looks straight down, so the built tiers above are not needed and go.
    for o in list(ship.children_recursive):
        if not o.name.startswith(keep + ('stackbow', 'topbow', 'stern_plate', 'meshy_hull', 'photo_')):
            bpy.data.objects.remove(o, do_unlink=True)
    PX, CX, Y0 = 43.4, 513.0, Y_ACC + 0.9            # px per metre, hull centre column, world Y of image row 866
    x0, x1 = (0 - CX) / PX, (1024 - CX) / PX
    y0, y1 = Y0 - (1024 - 866) / PX, Y0 + 866 / PX
    me = bpy.data.meshes.new('acc_photo')
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    f = bm.faces.new([bm.verts.new((x, yy, DECK + 2.3)) for x, yy in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))])
    for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uvl].uv = uv
    bm.to_mesh(me)
    bm.free()
    photo = bpy.data.objects.new('acc_photo', me)
    s.collection.objects.link(photo)
    photo.parent = ship
    pm = bpy.data.materials.new('acc_photo')
    pm.use_nodes = True
    nt = pm.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '_export', 'ship_acc_rgba.png')))
    tex.extension = 'CLIP'
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = ACC_GAIN      # a photo, not paint under our sun: shown as it is
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    nt.links.new(tex.outputs['Alpha'], mx.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mx.inputs[1])
    nt.links.new(em.outputs['Emission'], mx.inputs[2])
    nt.links.new(mx.outputs['Shader'], nt.nodes['Material Output'].inputs['Surface'])
    me.materials.append(pm)

# ----------------------------------------------------------------------------- sea, wake, clouds
sea = sea_mat()
water = plane('sea', 3000, 3000, (0, 0, 0), sea)
wake_m = foam_mat('wake', length=-200, scale=0.3, strength=0.55)     # trails behind the stern, up the screen
me = bpy.data.meshes.new('wake')
bm = bmesh.new()
pts = [(-45, 320), (45, 320), (7.5, 60), (-7.5, 60)]
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
    quad = [(sgn * 3.2, 0), (sgn * 8.0, 10), (sgn * 11.0, 40), (sgn * 7.5, 16)]   # short bow waves: the bays near the stern stay clear
    if sgn > 0:
        quad.reverse()
    bm.faces.new([bm.verts.new((x, yy, 0.07)) for x, yy in quad])
    bm.to_mesh(bme)
    bm.free()
    bw = bpy.data.objects.new(f'bowwave{sgn}', bme)
    s.collection.objects.link(bw)
    bw.data.materials.append(foam_mat(f'bowfoam{sgn}', length=-40, scale=0.5, strength=0.7))
    bw.location = (0, BOW_Y + 2, 0)
# The reference looks straight down with almost no perspective (only container roofs, no sides):
# camera heights and lens are both VERT× the measured framing, so the footprint stays the same
VERT = 3.0
clouds = []
for i, z in enumerate((300 * VERT, 380 * VERT, 470 * VERT)):
    clouds.append(plane(f'cloud{i}', 2600, 2600, (0, 0, z), cloud_mat(f'cloud{i}', i + 1)))

sun_o = lib.studio_light(sun_dir=(-11, 0, -20), strength=1.05, sky_strength=0.06)   # angled: no glint under the camera
if MESHY:
    sun_o.data.specular_factor = 0.0             # no sun sheen: from straight above it only greys the paint
if MESHY:      # paint seen from straight above: the sky's mirror sheen only lays a grey veil over it
    for m_ in bpy.data.materials:
        b_ = m_.node_tree.nodes.get('Principled BSDF') if m_.use_nodes else None
        if b_ and not m_.name.startswith(('sea', 'wake', 'bowfoam', 'cloud', 'windows')):
            for n_ in ('Specular IOR Level', 'Metallic') if m_.name.startswith(('cont', 'roof')) else ('Specular IOR Level',):
                sock = b_.inputs[n_]
                if sock.is_linked:
                    m_.node_tree.links.remove(sock.links[0])
                sock.default_value = 0.0
            if 'Coat Weight' in b_.inputs:
                b_.inputs['Coat Weight'].default_value = 0.0
sun_o.data.angle = math.radians(9)                   # large soft sun: the ship's shadow on the water stays faint
# the reference shows no shadow or mirror image of the ship on the water (a pale band beside the hull)
for o in [ship] + list(ship.children_recursive):
    o.visible_glossy = False
    o.visible_shadow = False

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
    yy = lerp(-16, 32, seg(f, 1, 75))           # start over the bays only (bow out of shot), glide to the stern accommodation
    yy = lerp(yy, 6, seg(f, 75, 136))
    # the road it continues sits a touch right of centre on the page: start under it, settle centred
    cam.location = (-0.15 * (1 - seg(f, 1, 40)), yy, z)       # centre column under the truck (635px)
    if args.close:
        cy, ch = map(float, args.close.split(','))
        cam.location = (0, cy, ch)
    sea_map.inputs['Location'].default_value = (0, t * 90, 0)    # water streams past (up): ship sails down the screen
    for fm in foam_maps:
        fm.inputs['Location'].default_value = (0, t * 90, 0)
    for c in clouds:                           # clouds hang still while the ship sails on
        c.location.y = t * 90


for f in range(1, LAST + 1):
    apply(f)
    cam.keyframe_insert('location', frame=f)
    for c in clouds:
        c.keyframe_insert('location', frame=f)
    sea_map.inputs['Location'].keyframe_insert('default_value', frame=f)
    for fm in foam_maps:
        fm.inputs['Location'].keyframe_insert('default_value', frame=f)

# dev: the whole ship seen straight down, nothing else (a layout reference for the asset work)
if args.plan:
    for o in s.objects:
        if o.name in ('sea', 'wake') or o.name.startswith('bowwave') or o in clouds:
            o.hide_render = True
    cam.animation_data_clear()
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 46
    cam.location = (0, 0, 400)
    s.render.film_transparent = True
    s.render.image_settings.color_mode = 'RGBA'
    if args.close:                                   # 'y,width': square-on crop of one part of the ship
        cy, ch = map(float, args.close.split(','))
        cam.location = (0, cy, 400)
        cam_data.ortho_scale = ch

# ----------------------------------------------------------------------------- render
os.makedirs(args.out, exist_ok=True)
if '-' in args.frames:
    a, b = map(int, args.frames.split('-'))
    frames = range(a, b + 1)
else:
    frames = [int(x) for x in args.frames.split(',')]
frames = list(frames)
if args.count:
    frames = [round(frames[0] + i * (frames[-1] - frames[0]) / (args.count - 1)) for i in range(args.count)]
s.render.use_persistent_data = True             # the ship never changes: keep textures and BVH between frames
for i, f in enumerate(frames):
    s.render.filepath = os.path.join(args.out, f'f{(i + 1) if args.count else f:03d}.webp')
    if args.resume and os.path.exists(s.render.filepath):     # pick up after an interrupted run
        continue
    s.frame_set(f)
    bpy.ops.render.render(write_still=True)
    print('RENDERED', f, flush=True)
