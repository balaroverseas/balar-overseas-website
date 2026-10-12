"""Splits the Meshy image-to-3D reach stacker (one fused mesh) into the rig's moving parts.

The scan (from an AI-generated photo of a reach stacker, 8K texture) stands with its boom at a
fixed angle, telescope in and spreader at 20 ft. Every point is mapped into rig coordinates
(three.js, metres: X forward, Y up, Z to the camera side) and the faces are sorted into body, outer
and inner boom, spreader (centre and the two ends), cylinder barrel and rod, and the four wheels, by
where they sit relative to the boom, the cylinder line, the head pin and the axles. Each part is
written in its own pivot frame so the page drives it like the built parts (reachstacker3d.js,
useMeshyStacker, which holds the matching constants). The texture is left exactly as generated.

  blender -b --factory-startup -P prep_meshy_stacker.py -- in.glb out.glb
  -> out.glb (2K maps, for the page) and out_hi.glb (full-resolution maps, for the Cycles render)
"""
import sys
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]

# ---- the scan, measured on its orthographic side and top views (model units)
S = 6.22                           # model units -> metres (head pin to twistlocks = the rig's 1.76 m)
FRONT_X = -0.322                   # model x of the front axle (rig X 2.6); the machine faces -x
GROUND_Z = -0.568                  # model z of the tyre contact patch (rig Y 0)
FRONT_RIG_X = 2.6


def to_rig(p):
    return Vector((FRONT_RIG_X - (p.x - FRONT_X) * S, (p.z - GROUND_Z) * S, p.y * S))


def rig2(x, z):                    # a point read off the side view -> rig (X, Y)
    return Vector((FRONT_RIG_X - (x - FRONT_X) * S, (z - GROUND_Z) * S))


PIV = rig2(0.638, 0.080)           # boom foot pin on the tower
ANG = 0.225                        # boom axis above horizontal as scanned
TIP = rig2(-0.783, 0.300)          # head pin the spreader hangs from
CYL_B = rig2(-0.105, -0.228)       # lift cylinder foot pin
CYL_A = rig2(0.198, 0.300)         # lift cylinder top pin (on the boom)
ROD_T = 0.657                      # barrel mouth, as a fraction of the cylinder length
U_INNER = 7.85                     # boom-local x where the inner section leaves the outer one
SPREADER_END_Z = 1.87              # |Z| beyond which the spreader's telescoping ends begin
R_W = 0.92
# wheels (they roll with the machine on the page): name -> nominal axle (X, Y), wheel plane Z,
# and the |Z| the tyre starts at
WHEELS = {
    'wFL': (2.6, 0.883, 1.77, 1.25), 'wFR': (2.6, 0.883, -1.77, 1.25),
    'wRL': (rig2(0.75, -0.42).x, 0.92, 2.0, 1.5), 'wRR': (rig2(0.75, -0.42).x, 0.92, -2.0, 1.5),
}
CA, SA = math.cos(ANG), math.sin(ANG)
CD = (CYL_A - CYL_B).normalized()
CLEN = (CYL_A - CYL_B).length


def boom_local(X, Y):
    dx, dy = X - PIV.x, Y - PIV.y
    return dx * CA + dy * SA, -dx * SA + dy * CA


def classify(c):
    X, Y, Z = c
    u, v = boom_local(X, Y)
    # spreader: everything under the head pin
    if Y < TIP.y - 0.15 and X > TIP.x - 1.45:
        return 'spreader' if abs(Z) < SPREADER_END_Z else ('spreadL' if Z > 0 else 'spreadR')
    # lift cylinders: a tube along the foot pin -> boom pin line, either side of the cab
    w = Vector((X, Y)) - CYL_B
    t = w.dot(CD) / CLEN
    d = abs(w.x * CD.y - w.y * CD.x)
    if 0.03 < t < 0.97 and d < 0.27 and 0.6 < abs(Z) < 1.15:
        return 'rod' if t > ROD_T else 'barrel'
    # boom: the band above its foot pin; the tower's head round the pin stays with the body
    if (Vector((X, Y)) - PIV).length < 0.42 and v < 0.12:
        return 'body'
    if u >= U_INNER:
        if u < 10.0 and -1.15 < v < 1.45 and abs(Z) < 1.0:
            return 'inner'
    elif u > 1.0:
        if -0.05 < v < 1.4 and abs(Z) < (1.15 if u < 4.5 else 0.8):
            return 'outer'
    elif u > -1.7:
        if -0.75 < v < 1.4 and abs(Z) < 1.3:
            return 'outer'
    return 'body'


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
src = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
src.data.transform(src.matrix_world)
src.matrix_world = Matrix.Identity(4)

# rig coordinates into the mesh (Blender holds three's (X,Y,Z) as (X,-Z,Y); the glTF export flips it back)
me = src.data
for vt in me.vertices:
    vt.co = to_rig(vt.co)
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
# straight cuts where the spreader's ends leave its centre (sorting whole triangles would leave a
# ragged edge there, and the ends are seen close when the box swings round)
for s in (1, -1):
    fs = [f for f in bm.faces if (lambda c: c.y < TIP.y - 0.15 and c.x > TIP.x - 1.45 and abs(c.z - s * SPREADER_END_Z) < 0.6)(f.calc_center_median())]
    geom = list({v for f in fs for v in f.verts}) + list({e for f in fs for e in f.edges}) + fs
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=(0, 0, s * SPREADER_END_Z), plane_no=(0, 0, 1))
bm.faces.ensure_lookup_table()
centres = [f.calc_center_median() for f in bm.faces]
labels = [classify(c) for c in centres]


# true axle of each tyre: circle fitted to its tread (lower half, clear of the mudguard), so the
# wheel turns about its own centre and does not wobble
def fit_circle(pts):
    n = len(pts)
    sx = sum(p[0] for p in pts); sy = sum(p[1] for p in pts)
    sxx = sum(p[0] ** 2 for p in pts); syy = sum(p[1] ** 2 for p in pts); sxy = sum(p[0] * p[1] for p in pts)
    sz = sum(p[0] ** 2 + p[1] ** 2 for p in pts)
    sxz = sum(p[0] * (p[0] ** 2 + p[1] ** 2) for p in pts); syz = sum(p[1] * (p[0] ** 2 + p[1] ** 2) for p in pts)
    a, b, c = Matrix(((sxx, sxy, sx), (sxy, syy, sy), (sx, sy, n))).inverted() @ Vector((sxz, syz, sz))
    cx, cy = a / 2, b / 2
    return cx, cy, math.sqrt(c + cx * cx + cy * cy)


FIT = {}
for name, (ax, ay, zc, z0) in WHEELS.items():
    pts = []
    for f, c, l in zip(bm.faces, centres, labels):
        if l != 'body' or c.z * zc <= 0 or abs(c.z) < z0 + 0.1 or c.y > ay - 0.1:
            continue
        d = (Vector((c.x, c.y)) - Vector((ax, ay))).length
        if R_W - 0.14 < d < R_W + 0.12 and abs(f.normal.z) < 0.3:
            pts.append((c.x, c.y))
    FIT[name] = fit_circle(pts)
print('WHEEL FIT', {n: tuple(round(v, 3) for v in f) for n, f in FIT.items()})
for k, (c, l) in enumerate(zip(centres, labels)):
    if l != 'body':
        continue
    for name, (ax, ay, zc, z0) in WHEELS.items():
        cx, cy, rr = FIT[name]
        if c.z * zc > 0 and abs(c.z) > z0 and (Vector((c.x, c.y)) - Vector((cx, cy))).length < rr + 0.015:
            labels[k] = name
counts = {}
for l in labels:
    counts[l] = counts.get(l, 0) + 1
print('SPLIT', counts)

# where the lettering planes go (reachstacker3d.js): the side faces of the boom and of the hull
zb = sorted(abs(c.z) for f, c, l in zip(bm.faces, centres, labels) if l == 'outer' and abs(f.normal.z) > 0.9 and 4.0 < boom_local(c.x, c.y)[0] < 7.4 and 0.1 < boom_local(c.x, c.y)[1] < 0.8)
zh = sorted(abs(c.z) for f, c, l in zip(bm.faces, centres, labels) if l == 'body' and abs(f.normal.z) > 0.9 and -1.4 < c.x < 0.0 and 1.45 < c.y < 2.05)
print('BOOM SIDE Z', [round(z, 3) for z in zb[::max(1, len(zb) // 8)]], 'HULL SIDE Z', [round(z, 3) for z in zh[::max(1, len(zh) // 8)]])
# section of the boom where the inner tube leaves it, and of the spreader's main beam (for the
# telescoping tubes the page adds)
sec = [(boom_local(c.x, c.y)[1], abs(c.z)) for c, l in zip(centres, labels) if l == 'inner' and U_INNER + 0.15 < boom_local(c.x, c.y)[0] < U_INNER + 0.9]
print('INNER SECTION v', round(min(s[0] for s in sec), 3), round(max(s[0] for s in sec), 3), 'half width', round(max(s[1] for s in sec), 3))
sp = [(c.x - TIP.x, c.y - TIP.y) for c, l in zip(centres, labels) if l in ('spreadL', 'spreadR') and abs(c.z) < SPREADER_END_Z + 0.6]
print('SPREADER BEAM x', round(min(s[0] for s in sp), 3), round(max(s[0] for s in sp), 3), 'y', round(min(s[1] for s in sp), 3), round(max(s[1] for s in sp), 3),
      'end z', round(max(abs(c.z) for c, l in zip(centres, labels) if l in ('spreadL', 'spreadR')), 3),
      'bottom', round(min(c.y - TIP.y for c, l in zip(centres, labels) if l.startswith('spread')), 3))


def frame(part):
    """matrix rig -> part-local (three.js axes)"""
    if part == 'body':
        return Matrix.Identity(4)
    if part in ('outer', 'inner'):                       # boom frame: foot pin, x along the axis
        return Matrix.Rotation(-ANG, 4, 'Z') @ Matrix.Translation((-PIV.x, -PIV.y, 0))
    if part.startswith('spread'):                        # hangs from the head pin
        return Matrix.Translation((-TIP.x, -TIP.y, 0))
    if part in WHEELS:                                   # about its fitted axle, in its wheel plane
        cx, cy, _ = FIT[part]
        return Matrix.Translation((-cx, -cy, -WHEELS[part][2]))
    # cylinders: origin at the foot pin, +Y along the cylinder (three: setFromUnitVectors(up, dir))
    rot = math.pi / 2 - math.atan2(CD.y, CD.x)
    return Matrix.Rotation(rot, 4, 'Z') @ Matrix.Translation((-CYL_B.x, -CYL_B.y, 0))


for name in ('body', 'outer', 'inner', 'spreader', 'spreadL', 'spreadR', 'barrel', 'rod', *WHEELS):
    b2 = bm.copy()
    b2.faces.ensure_lookup_table()
    bmesh.ops.delete(b2, geom=[f for f, l in zip(b2.faces, labels) if l != name], context='FACES')
    m2 = me.copy()
    b2.to_mesh(m2)
    b2.free()
    m2.transform(frame(name))
    m2.transform(Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))))      # three (X,Y,Z) -> Blender (X,-Z,Y)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new('M_' + name, m2))
bm.free()
bpy.data.objects.remove(src)
tl = boom_local(TIP.x, TIP.y)
al = boom_local(CYL_A.x, CYL_A.y)
print('RIG', {'PIVOT': tuple(round(v, 4) for v in PIV), 'ANG': ANG, 'TIP_LOCAL': tuple(round(v, 4) for v in tl), 'CYL_B': tuple(round(v, 4) for v in CYL_B),
              'CYL_A_LOCAL': tuple(round(v, 4) for v in al), 'CYL_LEN': round(CLEN, 4), 'ROD_T': ROD_T, 'U_INNER': U_INNER})

# two files: full-resolution maps for the Cycles render (journey_render.py swaps them onto the scan's
# material), and a 2K copy the page can hold in WebGL while it exports the animation
HI = DST.replace('.glb', '_hi.glb')
bpy.ops.export_scene.gltf(filepath=HI, export_format='GLB', export_image_format='WEBP', export_image_quality=95, export_draco_mesh_compression_enable=False)
for im in bpy.data.images:
    if max(im.size) > 2048:
        im.scale(2048, 2048)
        im.pack()
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_image_format='WEBP', export_image_quality=88, export_draco_mesh_compression_enable=False)
