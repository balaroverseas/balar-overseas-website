"""Import a 3MF (core + colorgroup materials) into Blender as one object per mesh resource,
placed by the build items / components, and save it as a .blend for the scenes to append.

  blender -b --factory-startup -P import3mf.py -- <in.3mf> <out.blend>
"""
import sys
import os
import zipfile
import xml.etree.ElementTree as ET
import bpy
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
NS = {'c': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
      'm': 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02'}

bpy.ops.wm.read_factory_settings(use_empty=True)
with zipfile.ZipFile(src) as z:
    name = [n for n in z.namelist() if n.lower().endswith('.model')][0]
    root = ET.fromstring(z.read(name))
unit = {'millimeter': 0.001, 'centimeter': 0.01, 'meter': 1.0, 'inch': 0.0254}.get(root.get('unit', 'millimeter'), 0.001)


def to_matrix(s):
    if not s:
        return Matrix.Identity(4)
    v = [float(x) for x in s.split()]
    # 3MF: m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32 (row vectors)
    return Matrix(((v[0], v[3], v[6], v[9]), (v[1], v[4], v[7], v[10]), (v[2], v[5], v[8], v[11]), (0, 0, 0, 1)))


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# colour groups → materials
mats = {}
for cg in root.iter('{%s}colorgroup' % NS['m']):
    gid = cg.get('id')
    for i, col in enumerate(cg.findall('m:color', NS)):
        h = col.get('color')
        m = bpy.data.materials.new(f'c{gid}_{i}_{h[1:7]}')
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*srgb(h[:7]), 1)
        b.inputs['Roughness'].default_value = 0.45
        mats[(gid, i)] = m

meshes, comps = {}, {}
for obj in root.find('c:resources', NS).findall('c:object', NS):
    oid = obj.get('id')
    mesh = obj.find('c:mesh', NS)
    if mesh is not None:
        vs = [(float(v.get('x')) * unit, float(v.get('y')) * unit, float(v.get('z')) * unit) for v in mesh.find('c:vertices', NS)]
        tris, tmat = [], []
        dpid, dpi = obj.get('pid'), obj.get('pindex')
        for t in mesh.find('c:triangles', NS):
            tris.append((int(t.get('v1')), int(t.get('v2')), int(t.get('v3'))))
            pid = t.get('pid', dpid)
            pi = t.get('p1', dpi)
            tmat.append((pid, int(pi)) if pid is not None and pi is not None else None)
        me = bpy.data.meshes.new(f'm{oid}')
        me.from_pydata(vs, [], tris)
        used = []
        for key in tmat:
            if key and key not in used:
                used.append(key)
        for key in used:
            me.materials.append(mats.get((key[0], key[1])))
        if used:
            idx = {k: i for i, k in enumerate(used)}
            for poly, key in zip(me.polygons, tmat):
                poly.material_index = idx.get(key, 0)
        me.update()
        meshes[oid] = me
    cs = obj.find('c:components', NS)
    if cs is not None:
        comps[oid] = [(c.get('objectid'), to_matrix(c.get('transform'))) for c in cs]

count = 0


def place(oid, mat, tag):
    global count
    if oid in meshes:
        o = bpy.data.objects.new(f'part_{oid}_{tag}', meshes[oid])
        o.matrix_world = mat
        bpy.context.scene.collection.objects.link(o)
        count += 1
    for cid, cm in comps.get(oid, []):
        place(cid, mat @ Matrix.Diagonal((1, 1, 1, 1)) @ scale_t(cm), f'{tag}.{cid}')


def scale_t(m):
    m = m.copy()
    m.translation = m.translation * unit
    return m


for i, it in enumerate(root.find('c:build', NS).findall('c:item', NS)):
    place(it.get('objectid'), scale_t(to_matrix(it.get('transform'))), str(i))

print('IMPORTED', count, 'objects')
for o in sorted(bpy.data.objects, key=lambda o: o.name):
    bb = [o.matrix_world @ __import__('mathutils').Vector(c) for c in o.bound_box]
    mn = [min(p[i] for p in bb) for i in range(3)]
    mx = [max(p[i] for p in bb) for i in range(3)]
    print('OBJ', o.name, len(o.data.vertices), [m.name for m in o.data.materials],
          'min', [round(x, 3) for x in mn], 'max', [round(x, 3) for x in mx])
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(dst))
print('SAVED', dst)
