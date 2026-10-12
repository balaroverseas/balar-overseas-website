"""Prepares the generated 40 ft container (Meshy scan) for the page and the Cycles render.

Brought into the same frame as the pack container it replaces (assets/models/container.glb), so the
page's placement code needs no change: long axis X, 12.065 x 2.924 (high) x 2.426 m, origin at the
bottom centre. One mesh, one material named CONTM (journey_render.py finds it by that name).

  blender -b --factory-startup -P prep_meshy_container.py -- in.glb out.glb [--flip]
  -> out.glb (2K maps, for the page) and out_hi.glb (full-resolution maps, for the render)
  --flip turns the box end for end (doors to the other end)
"""
import sys
import math
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
FLIP = '--flip' in argv
L, H, W = 12.065, 2.924, 2.426

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
box = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.context.scene.objects if o != box]:
    bpy.data.objects.remove(o)


def bounds():
    xs = [v.co for v in box.data.vertices]
    return Vector((min(v.x for v in xs), min(v.y for v in xs), min(v.z for v in xs))), Vector((max(v.x for v in xs), max(v.y for v in xs), max(v.z for v in xs)))


mn, mx = bounds()
size = mx - mn
print('SRC SIZE', [round(v, 3) for v in size])
turn = (math.pi / 2 if size.y > size.x else 0) + (math.pi if FLIP else 0)
if turn:
    box.data.transform(Matrix.Rotation(turn, 4, 'Z'))
mn, mx = bounds()
size = mx - mn
c = (mn + mx) / 2
box.data.transform(Matrix.Translation((-c.x, -c.y, -mn.z)))
box.data.transform(Matrix.Diagonal((L / size.x, W / size.y, H / size.z, 1)))
box.data.update()
mn, mx = bounds()
print('OUT BOUNDS', [round(v, 3) for v in mn], [round(v, 3) for v in mx], 'PROPORTION L/H before', round(size.x / size.z, 3))
box.name = 'CONTM'
box.data.name = 'CONTM'
for m in box.data.materials:
    m.name = 'CONTM'

HI = DST.replace('.glb', '_hi.glb')
bpy.ops.export_scene.gltf(filepath=HI, export_format='GLB', export_image_format='WEBP', export_image_quality=95, export_draco_mesh_compression_enable=False)
for im in bpy.data.images:
    if max(im.size) > 2048:
        im.scale(2048, 2048)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_image_format='WEBP', export_image_quality=88, export_draco_mesh_compression_enable=False)
print('WROTE', DST, HI)
