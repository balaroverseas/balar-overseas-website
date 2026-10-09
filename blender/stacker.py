"""Reach stacker drives up to the stack, picks the Balar box, backs off while turning to face
the camera, and a truck reverses in underneath; the box is set down, the spreader lets go and
the camera drops so the ground fills the lower part of the frame (frames 1-300, side view from
-Y, camera never orbits - like the reference). Transparent WebP frames + meta.json (ground line
per frame and the final framing)."""
import sys
import os
import math
import argparse
import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, cylinder, profile, arc, mat, wheel, container, empty, seg, lerp  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--frames', default='40')
ap.add_argument('--samples', type=int, default=96)
ap.add_argument('--res', default='1600x900')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'seq', 'stacker'))
args = ap.parse_args(argv)
rx, ry = map(int, args.res.split('x'))

s = lib.reset(samples=args.samples, res=(rx, ry), transparent=True)
s.frame_start, s.frame_end = 1, 150

# ----------------------------------------------------------------------------- materials
# The machine is the user's own reach-stacker model (3MF, imported by import3mf.py into
# assets/stacker_user.blend), scaled to life size and rigged for the shot: boom about its pivot pin,
# telescopic section along the boom, lift cylinders following the boom, spreader on its own.
ASSET = os.path.join(os.path.dirname(__file__), 'assets', 'stacker_user.blend')
with bpy.data.libraries.load(ASSET) as (src_lib, dst_lib):
    dst_lib.objects = list(src_lib.objects)
parts = {}
for o in dst_lib.objects:
    s.collection.objects.link(o)
    parts[int(o.name.split('_')[1])] = o
for o in parts.values():                      # smoother look for the round parts
    for p in o.data.polygons:
        p.use_smooth = False
S = 29.5                                      # print model → life size (Ø61 mm tyres → 1.8 m)
CXM = 0.0975                                  # model x midway between the axles


def M(x, z, y=0.0):
    """model point (mm-model metres) → stacker-local; the model is turned 180° to face +X"""
    return Vector(((CXM - x) * S, -y * S, z * S))


rs = empty('stacker', (-4.5, 0, 0))
model = empty('model', (CXM * S, 0, 0), parent=rs)
model.scale = (S, S, S)
model.rotation_euler = (0, 0, math.pi)
for o in parts.values():
    o.parent = model
# our lettering instead of the original decal on the boom
for i in (70, 71):
    bpy.data.objects.remove(parts.pop(i), do_unlink=True)
# the tyres carry the same brand in white on the sidewalls: paint that lettering tyre-black
tyre_black = mat('tyre_black', '#191919', rough=0.85)
for i in (9, 25, 53, 65):
    o = parts[i]
    for k, m_ in enumerate(o.data.materials):
        if m_ and 'F6F6F3' in m_.name:
            o.data.materials[k] = tyre_black
bpy.context.view_layer.update()


def adopt(obj, new_parent):
    mw = obj.matrix_world.copy()
    obj.parent = new_parent
    obj.matrix_parent_inverse = new_parent.matrix_world.inverted()
    obj.matrix_world = mw


PIVOT = M(0.194, 0.121)                       # boom pivot pin
TIP0 = M(-0.1955, 0.389)                      # top of the spreader head = boom tip at rest
A0, B0 = M(0.119, 0.196), M(0.029, 0.051)     # lift-cylinder pins: on the boom / on the chassis
REST_ANG = math.atan2((TIP0 - PIVOT).z, (TIP0 - PIVOT).x)
REST_LEN = (TIP0 - PIVOT).length
U0 = (TIP0 - PIVOT).normalized()
SP_H = (0.389 - 0.276) * S                    # spreader: twistlock bottom → head top
boom = empty('boom', PIVOT, parent=rs)
inner = empty('boom_inner', (0, 0, 0), parent=boom)
bpy.context.view_layer.update()
for i in (29, 35, 64, 57, 58, 59, 5, 6):
    adopt(parts[i], boom)
adopt(parts[36], inner)
# lift cylinders: barrel + rod per side, turning about the chassis pin, rod sliding out
rams = []
for barrel_i, rod_i in ((13, 14), (32, 33)):
    g = empty(f'cyl{barrel_i}', B0, parent=rs)
    g.rotation_mode = 'QUATERNION'
    rod_g = empty(f'rod{rod_i}', (0, 0, 0), parent=g)
    bpy.context.view_layer.update()
    adopt(parts[barrel_i], g)
    adopt(parts[rod_i], rod_g)
    rams.append((g, rod_g))
CYL0 = A0 - B0
# spreader: its own object, origin at the twistlock bottom centre, beam along local X
sp = empty('spreader', M(-0.1955, 0.276))      # under the boom tip, so the head stays on it
sp.parent = rs
sp.rotation_euler = (0, 0, math.pi / 2)
spfix = empty('spreader_fix', (0, 0, 0), parent=sp)
spfix.rotation_euler = (0, 0, -math.pi / 2)
bpy.context.view_layer.update()
for i in (39, 69, 47, 3, 48, 49, 50, 17, 21, 22, 24, 23, 26, 27, 28, 11, 12):
    adopt(parts[i], spfix)
sp_world_rest = sp.matrix_world.copy()
sp.parent = None
sp.matrix_world = sp_world_rest
white_txt = mat('white_txt', '#ffffff', rough=0.4)
# BALAR on the camera-facing side of the red boom, along its axis (boom-local, pivot at origin)
_perp = Vector((-U0.z, 0, U0.x))
_p = U0 * 3.6 - _perp * 0.2 + Vector((0, -1.2, 0))
t_ = lib.text('boom_logo', 'BALAR', 0.85, tuple(_p), white_txt, parent=boom)
t_.rotation_euler = (math.pi / 2, -REST_ANG, 0)
paint = mat('stacker_dummy', '#ffe900')
# the model's paint is bright yellow/red: AgX would wash it out, so this scene uses Standard
s.view_settings.view_transform = 'Standard'
s.view_settings.look = 'None'
s.view_settings.exposure = -0.25
# ----------------------------------------------------------------------------- containers
STACK_X = (7.6, 10.06)
stack_roots = [container('stack_blue', '#1f3c8f', loc=(STACK_X[0], 0, 0)), container('stack_orange', '#d4632a', loc=(STACK_X[1], 0, 0))]
for o in stack_roots:
    o.rotation_euler = (0, 0, math.pi / 2)
stack = [c for o in stack_roots for c in [o] + list(o.children_recursive)]   # hide_render is per object
hero = container('hero', '#9ea5ad', label='BALAR OVERSEAS', label_color='#1e2328')   # light grey like the reference

# truck reverses in from the right (cab on the right, like the reference) under the container
from truck import build_truck, DECK  # noqa: E402
truck, truck_wheels = build_truck(loc=(40, -8, 0), cab_color='#1a1c21')

lib.studio_light(sun_dir=(-55, 0, -32), strength=1.1, sky_strength=0.07)   # soft fill + rim
key_a = lib.sun_toward((0.45, 0.55, -0.7), strength=2.2)                   # key light from the camera side
lib.shadow_floor()   # contact shadows only; the black ground band is drawn by the page (like the reference)

# ----------------------------------------------------------------------------- animation
# Camera stays put (side view from -Y) like the reference; the machine does the moving:
# drive in → pick the top box → lift → back off while turning 90° to face the camera →
# camera pans onto the box → truck reverses in underneath → set down → spreader lets go →
# camera drops so the ground fills the lower 40% (the services panel takes over from there).
START = Vector(((STACK_X[0] + STACK_X[1]) / 2, 0, 2.59))
SP_UP = 2.59 + 0.05                       # spreader sits this far above the box origin
DRIVE_IN = (1, 60)
LIFT = (62, 96)
TURN = (100, 152)
PAN = (110, 176)
TRUCK_IN = (158, 214)
LOWER = (218, 248)
RELEASE = (250, 272)
FINAL = (258, 300)
LAST = 300
RS_A, RS_B, RS_C = -7.0, -4.5, -10.0      # stacker x: start, at the stack, after backing off
CARRY = Vector((8.0, 0, 7.6))             # box centre in stacker-local space while carried
CARRY_LOW = 3.0                           # box bottom once turned to face the camera (reference)
TRUCK_X = RS_C                            # trailer centre ends under the box
FINAL_DX = 0.3                            # last frame: camera centre relative to the trailer centre (keeps the stack out)
BOX_Y = -CARRY.x                          # box (and truck) y once the machine faces the camera


def rot(v, th):
    c, s_ = math.cos(th), math.sin(th)
    return Vector((v.x * c - v.y * s_, v.x * s_ + v.y * c, v.z))


def state(f):
    """Stacker position/heading and the spreader in stacker-local space."""
    drive = seg(f, *DRIVE_IN)
    back = seg(f, *TURN)
    th = lerp(0.0, -math.pi / 2, back)
    x = lerp(lerp(RS_A, RS_B, drive), RS_C, back)
    x += lerp(0, -20.0, seg(f, FINAL[0] + 2, LAST - 4) ** 1.3)     # finally drives out of shot (left)
    y = lerp(0, 6.0, seg(f, FINAL[0] + 4, LAST))
    rs_loc = Vector((x, y, 0))
    start_local = START - Vector((RS_B, 0, 0))                      # where the box sits, seen from the pick spot
    lift = seg(f, *LIFT)
    box_local = start_local.lerp(CARRY, lift)
    box_local.z += math.sin(lift * math.pi) * 0.8
    # like the reference: while turning, the box comes down to ~3 m (its bottom), hiding the machine
    box_local.z = lerp(box_local.z, CARRY_LOW, seg(f, TURN[0], TURN[1] + 10))
    sp_local = box_local + Vector((0, 0, SP_UP))
    # before the pick the spreader comes down from a parked position onto the box
    parked = TIP0 - Vector((0, 0, SP_H))      # boom at its modelled pose
    sp_local = parked.lerp(sp_local, seg(f, 8, 58)) if f < 60 else sp_local
    return rs_loc, th, sp_local, box_local


def truck_x(f):
    t = seg(f, *TRUCK_IN)
    return lerp(40.0, TRUCK_X, 1 - (1 - t) ** 2)                    # backs in, easing to a stop


def apply(f):
    rs_loc, th, sp_local, box_local = state(f)
    rs.location = rs_loc
    rs.rotation_euler = (0, 0, th)
    box_world = rs_loc + rot(box_local, th)
    if f < 60:                                                       # still on the stack
        box_world = START.copy()
    lower = seg(f, *LOWER)
    if f >= TURN[1]:                                                 # carried box is over the trailer now
        box_world.z = lerp(box_world.z, DECK, lower)
    if f >= RELEASE[0]:                                              # let go: the box stays on the truck
        rs_r, th_r, spl_r, bl_r = state(RELEASE[0])
        box_world = rs_r + rot(bl_r, th_r)
        box_world.z = DECK
    hero.location = box_world
    hero.rotation_euler = (0, 0, math.pi / 2 + (th if f >= 60 else 0))
    # spreader: rides on the box until released, then rises and pulls in
    if f < RELEASE[0]:
        sp_world = box_world + Vector((0, 0, SP_UP)) if f >= 60 else rs_loc + rot(sp_local, th)
        sp_local_now = rot(sp_world - rs_loc, -th)
    else:
        up = seg(f, *RELEASE)
        base = rot(Vector((box_world.x, box_world.y, DECK + SP_UP)) - rs_loc, -th)
        sp_local_now = base + Vector((-2.5 * up, 0, 6.5 * up))
        sp_world = rs_loc + rot(sp_local_now, th)
    sp.location = sp_world
    sp.rotation_euler = (0, 0, math.pi / 2 + th)
    tx = truck_x(f)
    truck.location = (tx, BOX_Y, 0)
    for w, r in truck_wheels:
        w.rotation_euler = (0, -(tx - 40.0) / r, 0)
    # boom IK (stacker-local): the spreader head top must sit at the boom tip
    tip = sp_local_now + Vector((0, 0, SP_H))
    d = tip - PIVOT
    delta = math.atan2(d.z, d.x) - REST_ANG
    boom.rotation_euler = (0, -delta, 0)
    inner.location = U0 * max(-4.0, d.length - REST_LEN)
    # lift cylinders follow the boom pin
    c_, s_ = math.cos(delta), math.sin(delta)
    r = A0 - PIVOT
    a_now = PIVOT + Vector((r.x * c_ - r.z * s_, 0, r.x * s_ + r.z * c_))
    v = a_now - B0
    q = CYL0.rotation_difference(v)
    for g, rod_g in rams:
        g.rotation_quaternion = q
        rod_g.location = CYL0.normalized() * (v.length - CYL0.length)    # camera: wide (stack on the right, ground at 90%) → pans/zooms onto the turned box →
    # drops so the ground line sits at 60% with the loaded truck centred
    wide = (Vector((1.1, 0, 6.24)), 30.0)
    held = (Vector((RS_C + 1.0, BOX_Y, 5.6)), 26.0)
    final = (Vector((TRUCK_X + FINAL_DX, BOX_Y, 1.63)), 29.0)
    p, fin = seg(f, *PAN), seg(f, *FINAL)
    target = wide[0].lerp(held[0], p).lerp(final[0], fin)
    width = lerp(lerp(wide[1], held[1], p), final[1], fin)
    cam['yaw'], cam['pitch'] = 0, 1.5
    lib.place_lens_camera(cam, tgt, target, width)
    return width


cam, tgt = lib.lens_camera((1.1, 0, 6.24), yaw_deg=0, pitch_deg=1.5, dist=90, width=30)

s.frame_end = LAST
widths = []
for f in range(1, LAST + 1):
    widths.append(apply(f))
    for o in [rs, hero, sp, boom, inner, cam, tgt, truck] + [r for b in rams for r in b] + [w for w, _ in truck_wheels]:
        for path in ('location', 'rotation_euler', 'rotation_quaternion', 'scale'):
            try:
                o.keyframe_insert(path, frame=f)
            except Exception:
                pass
    cam.data.keyframe_insert('lens', frame=f)
# ----------------------------------------------------------------------------- meta
# where the ground line (z=0 below the camera target) lands in each frame, 0 = top, 1 = bottom;
# the page uses it to keep its black ground band glued to the render
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
os.makedirs(args.out, exist_ok=True)
ground = []
for f in range(1, LAST + 1):
    s.frame_set(f)
    p = tgt.matrix_world.translation.copy()
    p.z = 0
    ground.append(round(1 - world_to_camera_view(s, cam, p).y, 4))
import json  # noqa: E402
with open(os.path.join(args.out, 'meta.json'), 'w') as fh:
    # end: framing of the last frame, so the live scene can pick up exactly there
    json.dump({'count': LAST, 'ground': ground, 'end': {'width': widths[-1], 'dx': 1.35 - FINAL_DX}}, fh)
if os.environ.get('BO_DEBUG'):
    s.frame_set(1)
    bpy.context.view_layer.update()
    from mathutils import Vector as _V
    for i in (36, 39, 69, 47, 49, 29, 35, 58):
        o = parts.get(i)
        if not o:
            continue
        bb = [o.matrix_world @ _V(c) for c in o.bound_box]
        print('DBG', i, 'x', round(min(p.x for p in bb), 2), round(max(p.x for p in bb), 2), 'z', round(min(p.z for p in bb), 2), round(max(p.z for p in bb), 2))
    print('DBG sp', tuple(round(v, 2) for v in sp.matrix_world.translation), 'boom', tuple(round(v, 2) for v in boom.matrix_world.translation), 'TIP0', tuple(round(v, 2) for v in TIP0), 'rs', tuple(round(v, 2) for v in rs.location))
if args.frames == 'meta':
    sys.exit(0)

# ----------------------------------------------------------------------------- render
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
