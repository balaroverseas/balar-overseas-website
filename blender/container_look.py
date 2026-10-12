"""Look-dev stills of the prepared container: both ends and one long side, flat-on (orthographic).

  blender -b --factory-startup -P container_look.py -- model_hi.glb out_dir
"""
import sys
import os
import math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=SRC)
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
sd = bpy.data.lights.new('sun', 'SUN')
sd.energy = 2.0
sun = bpy.data.objects.new('sun', sd)
sc.collection.objects.link(sun)
cd = bpy.data.cameras.new('cam')
cd.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.view_settings.view_transform = 'Standard'
sc.render.image_settings.file_format = 'PNG'
os.makedirs(OUT, exist_ok=True)


def shot(name, pos, scale, res):
    cam.location = pos
    d = Vector((0, 0, 1.46)) - Vector(pos)
    d.z = 0
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sun.rotation_euler = (Vector(pos) + Vector((3, 3, 12))).normalized().to_track_quat('Z', 'Y').to_euler()
    cd.ortho_scale = scale
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)


shot('end_plusX', (20, 0, 1.46), 3.2, (1400, 1400))
shot('end_minusX', (-20, 0, 1.46), 3.2, (1400, 1400))

