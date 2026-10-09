"""Prepare the licensed Sketchfab models for the website (CC-BY 4.0 / CC-BY-SA 4.0, see CREDITS.md):
  T1  "MAN TGX 2010 V8 – High-Detail Semi-Truck" by DevPoly3D        (tractor, CC-BY 4.0)
  R1  "Container Trailer Chassis" by fabio.ardito                     (trailer, CC-BY-SA 4.0)
  C2  "Container Pack" by drcrazzie                                   (40 ft box, CC-BY 4.0)
Brand badges (MAN / V8 / author plate) are removed, the paint is changed to the Balar livery,
the trailer is decimated, and two GLBs are written for three.js:
  assets/models/truck.glb      tractor + trailer, metres, +X forward, ground at 0, the trailer's
                               container centre at the origin; wheels are separate nodes WHEEL_*
                               with their origin on the axle (spin about local Z in three.js)
  assets/models/container.glb  one 40 ft box, origin at the bottom centre, long axis along X

  blender -b --factory-startup -P prep_models.py -- <models_dir> [--preview out_dir]
"""
import sys
import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC = argv[0]
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'models')
os.makedirs(OUT, exist_ok=True)


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def import_into(path, coll_name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    coll = bpy.data.collections.new(coll_name)
    bpy.context.scene.collection.children.link(coll)
    for o in new:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
    return coll, new


def bake_transforms(objs):
    """apply parent chains so every mesh sits in world space with identity transform parent-free"""
    meshes = [o for o in objs if o.type == 'MESH']
    others = [o for o in objs if o.type != 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in others:
        bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        o.data = o.data.copy()          # instanced meshes: make single-user before applying
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    return meshes


def transform_all(meshes, m):
    for o in meshes:
        o.data.transform(m)


def bounds(objs):
    mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            mn = Vector(map(min, mn, p)); mx = Vector(map(max, mx, p))
    return mn, mx


def set_origin_to_center(o):
    mn, mx = bounds([o])
    c = (mn + mx) / 2
    o.data.transform(Matrix.Translation(-c))
    o.matrix_world = Matrix.Translation(c)


def paint(mat, hexcol, metal=None, rough=None):
    b = mat.node_tree.nodes.get('Principled BSDF')
    for l in list(b.inputs['Base Color'].links):
        mat.node_tree.links.remove(l)
    b.inputs['Base Color'].default_value = (*srgb(hexcol), 1)
    if metal is not None:
        b.inputs['Metallic'].default_value = metal
    if rough is not None:
        b.inputs['Roughness'].default_value = rough


bpy.ops.wm.read_factory_settings(use_empty=True)

# ============================================================================ tractor (T1)
_, t_objs = import_into(os.path.join(SRC, 'T1', 'x', 'scene.gltf'), 'tractor')
tractor = bake_transforms(t_objs)
# brand badges: front MAN/V8 + grille chrome (.002_Metalic), author plate text (_Metalic_0),
# side MAN/V8 (.016_Metalic)
for o in list(tractor):
    if '.002_Metalic' in o.name or o.name.endswith('ed_Metalic_0') or '.016_Metalic' in o.name:
        tractor.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
# the two front wheels sit ~0.6 units apart along the truck in the file: put the .002 one level
# with the .001 one (same axle)
fl = [o for o in tractor if o.name.startswith('Object_3.001_')]
fr = [o for o in tractor if o.name.startswith('Object_3.002_')]
if fl and fr:
    hub_l = [o for o in fl if 'Hubs' in o.name] or fl
    hub_r = [o for o in fr if 'Hubs' in o.name] or fr
    (a0, a1), (b0, b1) = bounds(hub_l), bounds(hub_r)
    dy = (a0.y + a1.y) / 2 - (b0.y + b1.y) / 2
    transform_all(fr, Matrix.Translation((0, dy, 0)))
    print('FRONT WHEEL aligned by', round(dy, 3))
# model units → metres from the wheelbase (front hubs y≈-10.97, rear hubs y≈11.99; real 4x2 TGX: 3.60 m)
S_T = 3.60 / (11.99 + 10.97)
mn, mx = bounds(tractor)
# +X forward (the model's front is −Y), tyres on the ground
transform_all(tractor, Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Scale(S_T, 4) @ Matrix.Translation((0, 0, -mn.z)))
tm_mn, tm_mx = bounds(tractor)
print('TRACTOR size', tuple(round(v, 2) for v in (tm_mx - tm_mn)), 'x', round(tm_mn.x, 2), round(tm_mx.x, 2))
# livery: body paint (material "Grey" is the blue) → Balar dark graphite
for m in bpy.data.materials:
    if m.name == 'Grey':
        paint(m, '#1c1f25', metal=0.55, rough=0.32)
    if m.name == 'Back_Trailor':
        paint(m, '#2a2d33', metal=0.6, rough=0.45)

# ============================================================================ trailer (R1)
_, r_objs = import_into(os.path.join(SRC, 'R1', 'R1.glb'), 'trailer')
trailer = bake_transforms(r_objs)
mn, mx = bounds(trailer)
print('TRAILER raw', tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx))
# front (gooseneck) is at −X in the file: turn it round so the front faces +X like the tractor
transform_all(trailer, Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation((0, 0, -mn.z)))
for m in bpy.data.materials:
    if m.name.startswith('paint_yellow'):
        paint(m, '#22252b', metal=0.5, rough=0.5)
# 663k → ~70k triangles
for o in trailer:
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > 3000:
        mod = o.modifiers.new('dec', 'DECIMATE')
        mod.ratio = 0.1 if tris > 20000 else 0.3
        bpy.context.view_layer.objects.active = o
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier='dec')

# ============================================================================ container (C2)
_, c_objs = import_into(os.path.join(SRC, 'C2', 'C2.glb'), 'container')
KEEP = 'Object_104'                       # one whole 40 ft box (shell + doors) from the stack
drop = [o for o in c_objs if o.type == 'MESH' and o.name != KEEP]
c_objs = [o for o in c_objs if o not in drop]
for o in drop:
    bpy.data.objects.remove(o, do_unlink=True)
cont = bake_transforms(c_objs)
mn, mx = bounds(cont)
print('CONTAINER raw', tuple(round(v, 3) for v in (mx - mn)))
c = (mn + mx) / 2
transform_all(cont, Matrix.Translation((-c.x, -c.y, -mn.z)))
if (mx - mn).y > (mx - mn).x:            # long axis along X
    transform_all(cont, Matrix.Rotation(math.pi / 2, 4, 'Z'))
# Balar box: the pack's red paint → light grey, keeping its dents, rust streaks and dirt
import numpy as np  # noqa: E402
for o in cont:
    for s in o.material_slots:
        b = s.material.node_tree.nodes.get('Principled BSDF')
        if not b or not b.inputs['Base Color'].links:
            continue
        img = b.inputs['Base Color'].links[0].from_node.image
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
        lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        lo, hi = np.percentile(lum, 5), np.percentile(lum, 95)
        t = np.clip((lum - lo) / max(1e-4, hi - lo), 0, 1)
        grey = 0.42 + 0.40 * t                         # light grey, detail kept as shading
        rust = np.clip((px[:, 0] - px[:, 2]) * 1.2 - 0.25, 0, 1) * 0.0  # (no extra rust tint)
        px[:, 0] = grey * 0.97 + rust; px[:, 1] = grey * 0.985; px[:, 2] = grey * 1.0
        img.pixels[:] = px.ravel()
        img.update()
        print('RECOLOURED', img.name, img.size[:])

# ============================================================================ assemble truck
tr_mn, tr_mx = bounds(trailer)
L = tr_mx.x - tr_mn.x
# kingpin ≈ 1.0 m behind the trailer's front; fifth wheel ≈ 0.45 m ahead of the drive axle
DRIVE_X = tm_mn.x + (tm_mx.x - tm_mn.x) * 0.0   # placeholder, recomputed below from the wheels
rear_wheels = [o for o in tractor if o.name.startswith('Object_3_')]
rw_mn, rw_mx = bounds(rear_wheels)
drive_x = (rw_mn.x + rw_mx.x) / 2
fifth_x = drive_x + 0.45
king_x = tr_mx.x - 1.0
transform_all(trailer, Matrix.Translation((fifth_x - king_x, 0, 0)))
tr_mn, tr_mx = bounds(trailer)
# the container sits centred on the trailer's deck: put that centre at the origin
centre = Vector(((tr_mn.x + tr_mx.x) / 2, 0, 0))
transform_all(tractor + trailer, Matrix.Translation(-centre))
print('TRUCK drive_x', round(drive_x - centre.x, 2), 'trailer x', round(tr_mn.x - centre.x, 2), round(tr_mx.x - centre.x, 2), 'deck_top', round(tr_mx.z, 3))

# wheels as separate nodes with the origin on the axle (three.js spins them)
wheel_words = ('Tyre', 'Rims', 'Hubs')
n = 0
for o in tractor + trailer:
    mats = [s.material.name for s in o.material_slots if s.material]
    if any(w.lower() in ' '.join(mats).lower() for w in wheel_words) or any(w.lower() in o.name.lower() for w in wheel_words):
        set_origin_to_center(o)
        o.name = f'WHEEL_{n:02d}'
        n += 1
print('WHEELS', n)

# ============================================================================ export
# web weight: truck textures at 512 px (they are small on screen), the hero box keeps 1024
cont_imgs = {l.from_node.image.name for o in cont for s in o.material_slots
             for l in (s.material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].links if s.material.node_tree.nodes.get('Principled BSDF') else [])}
for img in bpy.data.images:
    if img.size[0] > 512 and img.name not in cont_imgs:
        img.scale(512, max(1, int(img.size[1] * 512 / img.size[0])))


def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_image_format='WEBP', export_jpeg_quality=80,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print('EXPORTED', path, os.path.getsize(path))


export([o for o in tractor + trailer if o.name in bpy.data.objects], os.path.join(OUT, 'truck.glb'))
export(cont, os.path.join(OUT, 'container.glb'))

# ============================================================================ preview
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    # a box on the deck for the look
    for o in cont:
        o.location.z = 1.56
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1400, 700
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.85, 0.87, 0.9, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30)); sun.data.energy = 3.5
    cd = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
    cd.lens = 50
    for name, loc, tgt in (('side', (0, -34, 2.5), (0, 0, 2)), ('q', (22, -20, 9), (1, 0, 2))):
        cam.location = Vector(loc)
        cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, name + '.png')
        bpy.ops.render.render(write_still=True)
print('DONE')
