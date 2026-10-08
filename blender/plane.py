"""Four-engine freighter in Balar livery seen from straight above, flying up the screen
over layered clouds with the sea far below (frames 1–180). Transparent WebP frames by
default (the page shows the plane over the ship's clouds and then the white page); --bg
renders the sky too.

  blender -b -P plane.py -- --frames 1,90,180 --samples 12 --res 800x450
  blender -b -P plane.py -- --frames 1-180 --samples 32 --res 1600x900
"""
import sys
import os
import math
import argparse
import bpy
import bmesh

sys.path.append(os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, mat, empty, seg, lerp, prism, cloud_mat, plane  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--frames', default='1')
ap.add_argument('--samples', type=int, default=32)
ap.add_argument('--res', default='1600x900')
ap.add_argument('--bg', action='store_true', help='render the clouds/sea too (otherwise transparent, the page supplies the sky)')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'seq', 'plane'))
args = ap.parse_args(argv)
rx, ry = map(int, args.res.split('x'))

LAST = 180
s = lib.reset(samples=args.samples, res=(rx, ry), transparent=not args.bg)
s.frame_start, s.frame_end = 1, LAST
s.cycles.max_bounces = 4
s.cycles.transparent_max_bounces = 16


def lathe(name, prof, m, segs=56, parent=None, loc=(0, 0, 0)):
    """Surface of revolution around the Y axis from [(y, radius, z_offset), ...] (nose = +Y)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for y, r, zc in prof:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), y, zc + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for ring in (rings[0], rings[-1]):
        if len(set((round(v.co.x, 4), round(v.co.z, 4)) for v in ring)) > 1:
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    s.collection.objects.link(o)
    o.data.materials.append(m)
    o.location = loc
    if parent:
        o.parent = parent
    for p in o.data.polygons:
        p.use_smooth = True
    return o


# ----------------------------------------------------------------------------- materials
white = mat('jet_white', '#f4f5f7', metal=0.1, rough=0.25, coat=1.0, coat_rough=0.04)
wing_m = mat('jet_wing', '#d6dbe2', metal=0.4, rough=0.35, coat=0.5)
panel = mat('jet_panel', '#b3bac4', metal=0.5, rough=0.4)
indigo = mat('jet_indigo', '#3b2cff', metal=0.2, rough=0.3, coat=1.0)
orange = mat('jet_orange', '#ff8a3d', rough=0.35, coat=0.8)
dark = mat('jet_dark', '#15181d', metal=0.3, rough=0.3, coat=1.0)
nav_r = mat('nav_red', '#ff2a1a', emit='#ff2010', emit_strength=6)
nav_g = mat('nav_green', '#22ff66', emit='#10ff50', emit_strength=6)

# ----------------------------------------------------------------------------- aircraft (nose +Y)
jet = empty('jet')
R = 3.25
fus = [(36.0, 0.05, -0.6)]
for i in range(1, 13):                                  # rounded nose
    t = i / 12
    fus.append((36.0 - 9.5 * (1 - math.cos(t * math.pi / 2)), R * math.sin(t * math.pi / 2) ** 0.8, -0.6 * (1 - t)))
fus += [(14.0, R, 0), (-16.0, R, 0)]
for i in range(1, 11):                                  # tail cone, swept up
    t = i / 10
    fus.append((-16.0 - 19.0 * t, R * (1 - 0.82 * t ** 1.3), 1.6 * t ** 1.5))
lathe('fuselage', fus, white, parent=jet)
# upper-deck hump behind the cockpit
hump = [(31.0, 0.05, 1.6)] + [(31.0 - 6 * (1 - math.cos(t / 8 * math.pi / 2)), 2.0 * math.sin(t / 8 * math.pi / 2), 1.6) for t in range(1, 9)]
hump += [(14.0, 2.0, 1.6), (6.0, 1.2, 1.4), (2.0, 0.05, 1.0)]
lathe('hump', hump, white, parent=jet)
# cockpit windows, crown titles, tail stripe
box('cockpit', (2.2, 1.1, 0.25), (0, 29.8, 3.45), dark, bevel=0.1, parent=jet).rotation_euler = (math.radians(-18), 0, 0)
lib.text('crown_logo', 'BALAR OVERSEAS', 1.25, (0.62, -12.5, R + 0.02), indigo, rot=(0, 0, math.pi / 2), parent=jet)
box('crown_line', (0.18, 30.0, 0.05), (-1.0, -2.0, 3.12), orange, bevel=0.02, parent=jet)

# wings (low-mounted, swept) with flap lines and raked tips
wing_r = [(3.0, 9.0), (3.0, -6.5), (12.0, -10.5), (31.5, -21.0), (33.0, -19.0), (31.5, -16.0)]
for sgn in (-1, 1):
    pts = [(sgn * x, y) for x, y in wing_r]
    if sgn < 0:
        pts.reverse()
    prism(f'wing{sgn}', pts, -1.6, -0.9, wing_m, bevel=0.25, parent=jet)
    for i in range(3):                                    # flap track fairings / panel lines
        x = 9 + i * 7.5
        y_te = -6.5 - (x - 3) * (14.5 / 28.5)
        f = box(f'flap{sgn}{i}', (0.35, 3.2, 0.25), (sgn * x, y_te + 0.6, -0.8), panel, bevel=0.08, parent=jet)
    box(f'flap_line{sgn}', (25, 0.08, 0.05), (sgn * 17.5, -11.6, -0.86), panel, parent=jet).rotation_euler = (0, 0, sgn * math.radians(-27))
    box(f'nav{sgn}', (0.6, 0.6, 0.3), (sgn * 32.6, -19.6, -1.0), nav_g if sgn > 0 else nav_r, bevel=0.1, parent=jet)
    # engines: nacelles hung forward of the leading edge, indigo inlet lip
    for x in (11.0, 20.5):
        y_le = 9.0 - (x - 3.0) * (25.0 / 28.5)
        yc = y_le + 1.2
        nac = [(yc + 3.4, 1.05, 0), (yc + 3.5, 1.32, 0), (yc + 2.6, 1.42, 0), (yc - 1.2, 1.38, 0), (yc - 3.2, 0.95, 0), (yc - 3.9, 0.5, 0), (yc - 4.2, 0.05, 0)]
        lathe(f'nacelle{sgn}{x}', nac, white, segs=40, parent=jet, loc=(sgn * x, 0, -2.6))
        lathe(f'inlet{sgn}{x}', [(yc + 3.55, 1.1, 0), (yc + 3.3, 1.36, 0), (yc + 3.0, 1.38, 0), (yc + 3.0, 0.05, 0)], indigo, segs=40, parent=jet, loc=(sgn * x, 0, -2.6))
        box(f'pylon{sgn}{x}', (0.4, 4.5, 1.2), (sgn * x, yc - 1.0, -1.6), white, bevel=0.15, parent=jet)

# tailplane + fin (seen edge-on from above as a slim blade)
stab = [(1.0, -23.5), (1.0, -30.5), (11.5, -35.0), (12.0, -33.6)]
for sgn in (-1, 1):
    pts = [(sgn * x, y) for x, y in stab]
    if sgn < 0:
        pts.reverse()
    prism(f'stab{sgn}', pts, 1.0, 1.4, wing_m, bevel=0.15, parent=jet)
prism('fin', [(0.35, -22.0), (0.35, -33.5), (-0.35, -33.5), (-0.35, -22.0)], 1.5, 13.5, indigo, bevel=0.2, parent=jet)
box('fin_tip', (0.72, 4.0, 0.3), (0, -31.0, 13.5), orange, bevel=0.1, parent=jet)

# ----------------------------------------------------------------------------- sky below
sea_m = mat('far_sea', '#0a1f55', rough=0.3)
plane('far_sea', 9000, 9000, (0, 0, -1600), sea_m)
clouds = [plane(f'cloud{i}', 6000, 6000, (0, 0, z), cloud_mat(f'cloud{i}', i + 4)) for i, z in enumerate((-90, -190, -320))]
for o in clouds + [s.objects['far_sea']]:
    o.hide_render = not args.bg
lib.studio_light(sun_dir=(-22, 0, -30), strength=1.7, sky_strength=0.1)   # the page draws the soft shadow

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 36 * 220 / 64        # 64 m wide at the aircraft (wings just fit)
cam_data.sensor_width = 36
cam_data.clip_end = 6000
cam = bpy.data.objects.new('cam', cam_data)
s.collection.objects.link(cam)
s.camera = cam
cam.location = (0, 0, 220)


def apply(f):
    t = (f - 1) / (LAST - 1)
    # nose enters from the bottom, the jet settles centre-frame, then climbs out of the top
    jet.location.y = lerp(-62, -6, seg(f, 1, 80)) + lerp(0, 80, seg(f, 118, LAST) ** 1.4)
    jet.rotation_euler = (0, math.radians(4) * math.sin(t * math.pi * 2), 0)   # gentle roll
    for i, c in enumerate(clouds):
        c.location.y = -t * (900 - i * 150)      # clouds stream past underneath


for f in range(1, LAST + 1):
    apply(f)
    jet.keyframe_insert('location', frame=f)
    jet.keyframe_insert('rotation_euler', frame=f)
    for c in clouds:
        c.keyframe_insert('location', frame=f)

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
