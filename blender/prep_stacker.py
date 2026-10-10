"""Reach stacker model (Meshy "Reach Stacker" by oguz.backovski, CC0) -> assets/models/stacker.glb

The source is one fused AI mesh (~2M faces). It is scaled to a 6 m wheelbase, turned so the boom
points +X, cut into the parts the page animates and decimated:

  STK_BODY      chassis, cab, counterweight (static)
  STK_BOOM      outer boom, local frame: origin = foot pin, +X along the boom
  STK_INNER     telescope + head, same frame (slides along +X); a slimmer sleeve hides the gap
  STK_SPREADER  origin = head pin, hangs level; arms stretched to a 40 ft box
  STK_CYL       lift cylinder, origin = chassis pin, +Z along the cylinder, rest length CYL_LEN
  STK_WHEEL_n   tyres, origin = hub (spin about local Y)

The brand lettering is painted out of the texture (white on red -> red, dark on yellow -> yellow).

  blender -b --factory-startup -P prep_stacker.py -- <source.glb> <out.glb>
"""
import sys
import math
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
obj = next(o for o in sc.objects if o.type == 'MESH')
me = obj.data
me.transform(obj.matrix_world)
obj.matrix_world = Matrix.Identity(4)
for o in [o for o in sc.objects if o != obj]:
    bpy.data.objects.remove(o)

# ---------------------------------------------------------------- scale / orient (measured)
co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
zmin = co[:, 2].min()
FRONT_SRC, REAR_SRC = -0.0871, 0.8068          # tyre contact x in the source
S = 6.0 / (REAR_SRC - FRONT_SRC)
me.transform(Matrix.Translation((2.6 + FRONT_SRC * S, 0, -zmin * S)) @ Matrix.Diagonal((S, S, S, 1)) @ Matrix.Rotation(math.pi, 4, 'Z'))

# a first, even pass of decimation keeps the per-face work below manageable (2M -> ~300k faces)
mod0 = obj.modifiers.new('dec0', 'DECIMATE'); mod0.ratio = 0.15
with bpy.context.temp_override(object=obj, active_object=obj):
    bpy.ops.object.modifier_apply(modifier='dec0')
print('DECIMATED', len(me.polygons))

# joints, metres (x forward, z up) measured off grid renders of the scaled model
PIVOT = Vector((-3.2, 0, 3.35))                # boom foot pin
BOOM0 = math.radians(14.0)                     # boom angle as modelled
HEAD = Vector((6.15, 0, 5.55))                 # head pin the spreader hangs from
CYL_B = Vector((1.64, 0, 1.29))                # cylinder chassis pin
CYL_A = Vector((-0.78, 0, 4.70))               # cylinder boom pin
WHEELS = [(2.6, 0.72), (-3.4, 0.72)]           # (x, hub height)
WHEEL_R = 0.74

# ---------------------------------------------------------------- texture: paint the lettering out
img = next(i for i in bpy.data.images if i.name.startswith('base_color'))
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
rgb = px[..., :3]


def box_mean(a, r):
    c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r))), 0), 1)
    return (c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]) / (2 * r + 1) ** 2


r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]
red = ((r_ > 0.45) & (g_ < 0.3) & (b_ < 0.3) & (r_ > 2.2 * g_)).astype(np.float32)   # texture values are sRGB
yel = ((r_ > 0.6) & (g_ > 0.45) & (b_ < 0.35)).astype(np.float32)
red_n, yel_n = box_mean(red, 40), box_mean(yel, 40)   # letters are big: judge by a wide neighbourhood
white = (r_ > 0.62) & (g_ > 0.6) & (b_ > 0.55)
dark = (r_ < 0.3) & (g_ < 0.3) & (b_ < 0.3)
fix_red = white & (red_n > 0.3)
fix_yel = dark & (yel_n > 0.45)
# fill with the local average of the surrounding paint
for mask, base in ((fix_red, red), (fix_yel, yel)):
    w = box_mean(base, 24) + 1e-6
    for ch in range(3):
        avg = box_mean(rgb[..., ch] * base, 24) / w
        rgb[..., ch] = np.where(mask, avg, rgb[..., ch])
px[..., :3] = rgb
img.pixels[:] = px.ravel()
img.update()
print('LETTERING px painted:', int(fix_red.sum()), int(fix_yel.sum()))

# ---------------------------------------------------------------- classify faces
src_mat = me.materials[0]
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
uv_l = bm.loops.layers.uv.active
NF = len(bm.faces)
cen = np.array([tuple(f.calc_center_median()) for f in bm.faces])
uv = np.array([tuple(sum((l[uv_l].uv for l in f.loops), Vector((0, 0))) / len(f.loops)) for f in bm.faces])
ix = np.clip((uv[:, 0] % 1) * W, 0, W - 1).astype(int)
iy = np.clip((uv[:, 1] % 1) * H, 0, H - 1).astype(int)
col = rgb[iy, ix]
is_red = (col[:, 0] > 0.45) & (col[:, 1] < 0.3) & (col[:, 2] < 0.3) & (col[:, 0] > 2.2 * col[:, 1])
is_yel = (col[:, 0] > 0.6) & (col[:, 1] > 0.45) & (col[:, 2] < 0.35)
x, y, z = cen[:, 0], cen[:, 1], cen[:, 2]

ca, sa = math.cos(BOOM0), math.sin(BOOM0)
lx = (x - PIVOT.x) * ca + (z - PIVOT.z) * sa      # boom-local
ly = -(x - PIVOT.x) * sa + (z - PIVOT.z) * ca


def seg_dist(px_, pz_, a, b):
    ab = np.array([b.x - a.x, b.z - a.z]); t = ((px_ - a.x) * ab[0] + (pz_ - a.z) * ab[1]) / ab.dot(ab)
    t = np.clip(t, 0, 1)
    return np.hypot(px_ - (a.x + t * ab[0]), pz_ - (a.z + t * ab[1]))


part = np.zeros(NF, dtype=int)                  # 0 body
WHEEL_IDS = []
for k, (wx, wz) in enumerate(WHEELS):
    for s in (1, -1):
        mask = (np.hypot(x - wx, z - wz) < WHEEL_R) & (s * y > (0.78 if wx > 0 else 1.0))   # front axle has twin tyres
        WHEEL_IDS.append((10 + len(WHEEL_IDS), wx, wz, s))
        part[mask] = WHEEL_IDS[-1][0]
spreader = (x > 5.0) & (z < 5.62) & ~is_red
# the pin sits ~0.3-0.55 m under the boom's centre line: the band runs from just under the pin to above the top plate
boom_band = (lx > -1.3) & (lx < 11.0) & (ly > -0.3) & (ly < 1.3) & (z > 3.45)
boom = ((is_red & (z > 3.0)) | boom_band | ((x > 5.3) & (z >= 5.62))) & ~spreader
cyl = (seg_dist(x, z, CYL_B, CYL_A) < 0.26) & (z > 1.4) & ~boom & ~is_yel
part[cyl] = 3
part[boom] = 1
part[spreader] = 4
INNER_FROM = 7.0                                 # boom-local x where the telescope starts
part[(part == 1) & (lx >= INNER_FROM)] = 2
print('FACES', {int(k): int((part == k).sum()) for k in np.unique(part)})


# ---------------------------------------------------------------- split into objects
def extract(name, ids, frame, decimate):
    """New object from the faces in `ids`, vertices mapped by `frame` (4x4 world -> local)."""
    b2 = bm.copy()
    b2.faces.ensure_lookup_table()
    keep = set(np.nonzero(np.isin(part, ids))[0].tolist())
    bmesh.ops.delete(b2, geom=[f for i, f in enumerate(b2.faces) if i not in keep], context='FACES')
    m2 = bpy.data.meshes.new(name)
    b2.to_mesh(m2)
    b2.free()
    m2.transform(frame)
    m2.materials.append(src_mat)
    o2 = bpy.data.objects.new(name, m2)
    sc.collection.objects.link(o2)
    if decimate < 1:
        mod = o2.modifiers.new('dec', 'DECIMATE')
        mod.ratio = decimate
        bpy.context.view_layer.objects.active = o2
        with bpy.context.temp_override(object=o2, active_object=o2):
            bpy.ops.object.modifier_apply(modifier='dec')
    print('OBJ', name, len(o2.data.polygons))
    return o2


def frame(origin, angle=0.0):
    """World -> local: translate origin to 0, then undo a rotation `angle` about -Y (x up towards z)."""
    return Matrix.Rotation(angle, 4, 'Y') @ Matrix.Translation(-origin)


DEC = 0.5
extract('STK_BODY', [0], Matrix.Identity(4), DEC)
boom_frame = frame(PIVOT, BOOM0)              # rotating by +angle about Y maps the boom axis onto +X
extract('STK_BOOM', [1], boom_frame, DEC)
inner = extract('STK_INNER', [2], boom_frame, DEC)
# sleeve: a slimmer copy of the outer section just behind the telescope, hidden inside the boom
sleeve_ids = np.nonzero((part == 1) & (lx > INNER_FROM - 3.0) & (lx < INNER_FROM))[0]
part_bak = part.copy()
part[sleeve_ids] = 99
sl = extract('STK_SLEEVE', [99], boom_frame, DEC)
part = part_bak
sl.data.transform(Matrix.Diagonal((1, 0.86, 0.86, 1)))
# merge the sleeve into the telescope object
with bpy.context.temp_override(active_object=inner, selected_editable_objects=[inner, sl], object=inner):
    bpy.ops.object.join()


# spreader: head-pin origin; stretch the arms so the twistlocks sit on a 40 ft box
sp = extract('STK_SPREADER', [4], frame(HEAD), DEC)
A0, A1, GROW = 1.0, 3.3, (12.192 - 7.57) / 2
for v in sp.data.vertices:
    a = abs(v.co.y)
    if a > A1:
        v.co.y += math.copysign(GROW, v.co.y)
    elif a > A0:
        v.co.y = math.copysign(A0 + (a - A0) * (A1 + GROW - A0) / (A1 - A0), v.co.y)

# cylinder: chassis-pin origin, +Z along the cylinder
d = (CYL_A - CYL_B)
CYL_LEN = d.length
cyl_rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
extract('STK_CYL', [3], cyl_rot.inverted() @ Matrix.Translation(-CYL_B), 0.8)

for pid, wx, wz, s in WHEEL_IDS:
    extract(f'STK_WHEEL_{pid - 10}', [pid], Matrix.Translation(-Vector((wx, 0, wz))), 0.6)

bpy.data.objects.remove(obj)

# textures: smaller for the web; drop the emissive map
for i in bpy.data.images:
    if i.size[0] > 1024:
        i.scale(1024, 1024)
for m in bpy.data.materials:
    if m.use_nodes:
        b = m.node_tree.nodes.get('Principled BSDF')
        if b:
            for lk in list(b.inputs['Emission Color'].links):
                m.node_tree.links.remove(lk)
            b.inputs['Emission Color'].default_value = (0, 0, 0, 1)   # unlinked socket defaults to white: no glow
            b.inputs['Emission Strength'].default_value = 0.0

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=7, export_image_format='JPEG', export_jpeg_quality=82,
                          export_apply=True, export_yup=True)
print('RIG', dict(PIVOT=(PIVOT.x, PIVOT.z), BOOM0=math.degrees(BOOM0), HEAD=(HEAD.x, HEAD.z),
                  CYL_B=(CYL_B.x, CYL_B.z), CYL_A=(CYL_A.x, CYL_A.z), CYL_LEN=CYL_LEN))
