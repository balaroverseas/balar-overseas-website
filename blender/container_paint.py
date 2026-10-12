"""Unlit stills of the prepared container's two ends (base colour only), for reading its paint colour.

  blender -b --factory-startup -P container_paint.py -- model_hi.glb out_dir
"""
import sys
import os
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=SRC)
for m in bpy.data.materials:
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    src = b.inputs['Base Color'].links[0].from_socket
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(src, em.inputs['Color'])
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
w = bpy.data.worlds.new('w')
sc.world = w
cd = bpy.data.cameras.new('cam')
cd.type = 'ORTHO'
cd.ortho_scale = 3.2
cam = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 4
sc.view_settings.view_transform = 'Standard'
sc.render.image_settings.file_format = 'PNG'
sc.render.resolution_x = sc.render.resolution_y = 1400
os.makedirs(OUT, exist_ok=True)
for name, x in (('flat_plusX', 20), ('flat_minusX', -20)):
    cam.location = (x, 0, 1.46)
    cam.rotation_euler = Vector((-x, 0, 0)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
