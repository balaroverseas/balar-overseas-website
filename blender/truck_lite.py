"""Phones: a lighter copy of assets/models/truck.glb (the live truck is ~140k triangles, 9/10 of the
phone scene). Every mesh is decimated to RATIO of its triangles (small parts are left whole); node
names, the hierarchy (WHEEL_* spin nodes) and the materials are kept.
blender -b --factory-startup -t 6 -P blender/truck_lite.py -- [ratio] [out]"""
import bpy, sys, os

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RATIO = float(a[0]) if a else 0.3
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = a[1] if len(a) > 1 else os.path.join(ROOT, 'assets', 'models', 'truck_m.glb')
KEEP_UNDER = 600          # triangles: parts this small stay as they are

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets', 'models', 'truck.glb'))

def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

before = after = 0
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    n = tris(o)
    before += n
    if n > KEEP_UNDER:
        m = o.modifiers.new('lite', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = RATIO
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier=m.name)
    after += tris(o)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_image_format='WEBP', export_jpeg_quality=80,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
print('TRIS', before, '->', after, 'EXPORTED', OUT, os.path.getsize(OUT))
