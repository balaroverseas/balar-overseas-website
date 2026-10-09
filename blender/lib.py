"""Shared helpers for the Balar Overseas Blender scenes (run with Blender 5.x, Cycles).

Everything is modelled in code so the scenes are fully our own: no downloaded assets.
Units are metres, Z is up, the side-view camera looks along +Y (X = right).
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector


# ----------------------------------------------------------------------------- scene
def reset(samples=96, res=(1600, 900), transparent=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    # GPU needs an NVIDIA driver new enough for this Blender build; set BO_GPU=1 once updated.
    if os.environ.get('BO_GPU') == '1':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'CUDA'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'CUDA'
        s.cycles.device = 'GPU'
    else:
        s.cycles.device = 'CPU'
        s.render.threads_mode = 'AUTO'
    s.cycles.samples = samples
    s.render.use_persistent_data = True   # keep scene data between frames (much faster sequences)
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 6
    s.render.resolution_x, s.render.resolution_y = res
    s.render.film_transparent = transparent
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = 'AgX - Punchy'
    s.render.image_settings.file_format = 'WEBP'
    s.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    s.render.image_settings.quality = 82
    return s


def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ----------------------------------------------------------------------------- materials
def mat(name, color='#ffffff', metal=0.0, rough=0.5, coat=0.0, coat_rough=0.08,
        emit=None, emit_strength=0.0, transmission=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(color), 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = coat_rough
    if emit:
        b.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def corrugated(name, color, scale=3.6, label_color=None, rough=0.5):
    """Painted steel with vertical corrugation (bump from a wave texture along local X)."""
    m = mat(name, color, metal=0.25, rough=rough, coat=0.15)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    # corrugation on the long sides (bands along X) and on the ends (bands along Y)
    waves = []
    for direction in ('X', 'Y'):
        wave = nt.nodes.new('ShaderNodeTexWave')
        wave.wave_type = 'BANDS'
        wave.bands_direction = direction
        wave.wave_profile = 'SAW'
        wave.inputs['Scale'].default_value = scale
        nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
        waves.append(wave)
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(waves[0].outputs['Fac'], add.inputs[0])
    nt.links.new(waves[1].outputs['Fac'], add.inputs[1])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 1.0
    bump.inputs['Distance'].default_value = 0.09
    nt.links.new(add.outputs['Value'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    # subtle grime variation
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*[c * 0.82 for c in srgb(color)], 1)
    ramp.color_ramp.elements[1].color = (*srgb(color), 1)
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m


def hazard(name='hazard'):
    """Yellow/black diagonal stripes."""
    m = mat(name, '#f2c230', rough=0.45, coat=0.3)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'DIAGONAL'
    wave.wave_profile = 'SAW'
    wave.inputs['Scale'].default_value = 3.5
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = (*srgb('#f2c230'), 1)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = (*srgb('#141414'), 1)
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m


def rubber(name='rubber'):
    m = mat(name, '#141414', rough=0.85)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 60
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.25
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


# ----------------------------------------------------------------------------- geometry
def _finish(o, m, bevel, segments, smooth=True, parent=None):
    if m:
        o.data.materials.append(m)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        mod.harden_normals = False
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
        mod = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    if parent:
        o.parent = parent
    return o


def _obj(name, mesh):
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def box(name, size, loc, m=None, bevel=0.03, segments=3, rot=(0, 0, 0), parent=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    o = _obj(name, me)
    o.location = loc
    o.rotation_euler = rot
    return _finish(o, m, bevel, segments, parent=parent)


def cylinder(name, radius, depth, loc, m=None, axis='Y', verts=48, bevel=0.0, segments=3, parent=None, radius2=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=radius, radius2=radius2 if radius2 is not None else radius, depth=depth)
    bm.to_mesh(me)
    bm.free()
    o = _obj(name, me)
    o.location = loc
    if axis == 'Y':
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == 'X':
        o.rotation_euler = (0, math.pi / 2, 0)
    return _finish(o, m, bevel, segments, parent=parent)


def profile(name, pts, depth, m=None, y=0.0, bevel=0.05, segments=4, parent=None):
    """Extrude a closed 2D outline drawn in the X/Z plane across Y (centred on y)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    front = [bm.verts.new((x, y - depth / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, y + depth / 2, z)) for x, z in pts]
    bm.faces.new(front[::-1])
    bm.faces.new(back)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = _obj(name, me)
    return _finish(o, m, bevel, segments, parent=parent)


def arc(cx, cz, r, a0, a1, n=16):
    """Points on an arc in the X/Z plane, angles in degrees (counter-clockwise)."""
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def text(name, body, size, loc, m, rot=(math.pi / 2, 0, 0), extrude=0.005, parent=None, align='LEFT'):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    o = _obj(name, cu)
    o.location = loc
    o.rotation_euler = rot
    o.data.materials.append(m)
    if parent:
        o.parent = parent
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


def wheel(name, r, width, rim_color='#f2c230', loc=(0, 0, 0), parent=None, studs=10):
    """Tyre with rounded shoulders, tread bump, painted rim and hub with studs. Axis along Y."""
    root = empty(name, loc, parent)
    rub = bpy.data.materials.get('rubber') or rubber()
    tyre = cylinder(name + '_tyre', r, width, (0, 0, 0), rub, axis='Y', verts=64, bevel=width * 0.28, segments=6, parent=root)
    rim_m = bpy.data.materials.get('rim_' + rim_color) or mat('rim_' + rim_color, rim_color, metal=0.3, rough=0.35, coat=0.6)
    cylinder(name + '_rim', r * 0.6, width * 1.02, (0, 0, 0), rim_m, axis='Y', verts=48, bevel=0.02, parent=root)
    hub_m = bpy.data.materials.get('hub') or mat('hub', '#3a3d42', metal=0.8, rough=0.35)
    cylinder(name + '_hub', r * 0.24, width * 1.08, (0, 0, 0), hub_m, axis='Y', verts=32, bevel=0.015, parent=root, radius2=r * 0.2)
    for i in range(studs):
        a = 2 * math.pi * i / studs
        cylinder(name + f'_stud{i}', r * 0.035, width * 1.1, (math.cos(a) * r * 0.36, 0, math.sin(a) * r * 0.36), hub_m, axis='Y', verts=12, parent=root)
    return root


def corr_wall(name, length, height, m, parent, place, pitch=0.28, depth=0.045):
    """Trapezoidal corrugated sheet. `place(u, v)` maps (position along the wall,
    outward offset) to a local (x, y, z) base point; the sheet rises `height` in Z."""
    us, vs = [], []
    n = int(length / pitch)
    start = -n * pitch / 2
    for i in range(n):
        u0 = start + i * pitch
        for f, v in ((0.0, 0.0), (0.15, depth), (0.5, depth), (0.65, 0.0)):
            us.append(u0 + f * pitch)
            vs.append(v)
    us.append(start + n * pitch)
    vs.append(0.0)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bottom, top = [], []
    for u, v in zip(us, vs):
        x, y, z = place(u, v)
        bottom.append(bm.verts.new((x, y, z)))
        top.append(bm.verts.new((x, y, z + height)))
    for i in range(len(bottom) - 1):
        bm.faces.new((bottom[i], bottom[i + 1], top[i + 1], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = _obj(name, me)
    o.data.materials.append(m)
    sol = o.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.01
    o.parent = parent
    return o


def container(name, color, label=None, length=12.19, width=2.44, height=2.59, loc=(0, 0, 0), parent=None, label_color='#2a2a2a'):
    """ISO container with corrugated walls, corner castings, door bars and a painted label.
    Local origin = centre of the bottom face, long axis along X."""
    root = empty(name, loc, parent)
    body = corrugated(name + '_paint', color)
    d = 0.045  # corrugation depth
    box(name + '_core', (length - 0.3, width - 0.2, height - 0.24), (0, 0, height / 2), body, bevel=0.0, parent=root)
    # real corrugated walls: long sides (along X) and the blank end (along Y)
    for side in (-1, 1):
        corr_wall(name + f'_side{side}', length - 0.3, height - 0.3, body, root,
                  lambda u, v, s=side: (u, s * (width / 2 - d + v), 0.15), pitch=0.28, depth=d)
    corr_wall(name + '_end', width - 0.3, height - 0.3, body, root,
              lambda u, v: (-(length / 2 - d + v), u, 0.15), pitch=0.24, depth=d)
    box(name + '_roof', (length - 0.2, width - 0.1, 0.06), (0, 0, height - 0.12), body, bevel=0.01, parent=root)
    # door end: two door leaves with a centre seam
    doors = mat(name + '_doors', color, metal=0.3, rough=0.45, coat=0.2)
    for yy in (-width / 4, width / 4):
        box(name + '_door', (0.04, width / 2 - 0.08, height - 0.3), (length / 2 - 0.06, yy, height / 2), doors, bevel=0.01, parent=root)
    frame = mat(name + '_frame', color, metal=0.3, rough=0.5)
    frame_dark = mat(name + '_frame_d', '#2a2a2a', metal=0.4, rough=0.6)
    # top and bottom rails + corner posts
    for z in (0.08, height - 0.08):
        for yy in (-width / 2 + 0.06, width / 2 - 0.06):
            box(name + '_rail', (length, 0.12, 0.16), (0, yy, z), frame, bevel=0.01, parent=root)
    for xx in (-length / 2 + 0.08, length / 2 - 0.08):
        for yy in (-width / 2 + 0.08, width / 2 - 0.08):
            box(name + '_post', (0.16, 0.16, height), (xx, yy, height / 2), frame, bevel=0.01, parent=root)
            for z in (0.09, height - 0.09):
                box(name + '_cast', (0.2, 0.2, 0.18), (xx, yy, z), frame_dark, bevel=0.01, parent=root)
    # door locking bars on the +X end
    steel = bpy.data.materials.get('steel') or mat('steel', '#b8bcc2', metal=0.9, rough=0.3)
    for i, yy in enumerate((-0.85, -0.35, 0.35, 0.85)):
        cylinder(name + f'_bar{i}', 0.025, height - 0.4, (length / 2 + 0.01, yy, height / 2), steel, axis='Z', verts=12, parent=root)
    if label:
        lm = mat(name + '_label', label_color, rough=0.6)
        text(name + '_txt', label, 0.55, (-length / 2 + 0.7, -width / 2 - 0.006, height * 0.42), lm, parent=root)
    return root


# ----------------------------------------------------------------------------- lighting
def studio_light(sun_dir=(-35, 0, -40), strength=4.0, sky_strength=0.9):
    """Soft daylight: sky dome for fill, sun for crisp shadows; camera sees transparency."""
    w = bpy.data.worlds.new('world')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA' if 'NISHITA' in [i.identifier for i in sky.bl_rna.properties['sky_type'].enum_items] else sky.sky_type
    try:
        sky.sun_elevation = math.radians(48)
        sky.sun_rotation = math.radians(210)
    except Exception:
        pass
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = sky_strength
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = strength
    sun.angle = math.radians(3.5)
    so = bpy.data.objects.new('sun', sun)
    bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = tuple(math.radians(a) for a in sun_dir)
    return so


def shadow_floor(size=200, z=0.0):
    me = bpy.data.meshes.new('floor')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me)
    bm.free()
    o = _obj('floor', me)
    o.location = (0, 0, z)
    o.is_shadow_catcher = True
    return o


def ortho_camera(scale, loc, rot=(math.pi / 2, 0, 0)):
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = scale
    cam.clip_end = 1000
    o = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.scene.camera = o
    return o


def sun_toward(direction, strength=3.0, angle_deg=3.0):
    """Sun light travelling along `direction` (e.g. from the camera side, slightly down)."""
    sun = bpy.data.lights.new('key', 'SUN')
    sun.energy = strength
    sun.angle = math.radians(angle_deg)
    o = bpy.data.objects.new('key', sun)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = Vector((0, 0, -1)).rotation_difference(Vector(direction).normalized()).to_euler()
    return o


def lens_camera(target, yaw_deg=12, pitch_deg=6, dist=70, width=27):
    """Long-lens perspective camera aimed at `target` from the front (-Y), with the given
    horizontal frame width at the target distance. Returns (camera, target_empty)."""
    tgt = empty('cam_target', target)
    cam = bpy.data.cameras.new('cam')
    cam.sensor_fit = 'HORIZONTAL'
    cam.sensor_width = 36
    cam.clip_end = 2000
    o = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o
    c = o.constraints.new('TRACK_TO')
    c.target = tgt
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'
    o['dist'], o['yaw'], o['pitch'] = dist, yaw_deg, pitch_deg
    place_lens_camera(o, tgt, target, width)
    return o, tgt


def place_lens_camera(o, tgt, target, width):
    yaw, pitch, dist = math.radians(o['yaw']), math.radians(o['pitch']), o['dist']
    tgt.location = target
    o.location = Vector(target) + Vector((math.sin(yaw) * math.cos(pitch) * dist, -math.cos(yaw) * math.cos(pitch) * dist, math.sin(pitch) * dist))
    o.data.lens = 36 * dist / width


def key(obj, frame, loc=None, rot=None, scale=None):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert('location', frame=frame)
    if rot is not None:
        obj.rotation_euler = rot
        obj.keyframe_insert('rotation_euler', frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert('scale', frame=frame)


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def seg(f, a, b):
    return smooth((f - a) / (b - a))


def lerp(a, b, t):
    return a + (b - a) * t


# ----------------------------------------------------------------------------- top-down scenes (ship, plane)
def prism(name, pts, z0, z1, m, bevel=0.15, parent=None):
    """Extrude a closed outline drawn in the X/Y plane (top view) from z0 to z1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [v for v in r['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(m)
    if parent:
        o.parent = parent
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width, b.segments, b.limit_method = bevel, 3, 'ANGLE'
    return o


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def cloud_mat(name, seed):
    """Puffy cloud layer; fades out when the camera gets close so passing through never pops."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes['Material Output']
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Roughness'].default_value = 1.0
    b.inputs['Emission Color'].default_value = (0.82, 0.86, 0.95, 1)
    b.inputs['Emission Strength'].default_value = 0.9
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (seed * 137.0, seed * 59.0, 0)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = node(nt, 'ShaderNodeTexNoise', Scale=0.0045, Detail=12.0, Roughness=0.62)
    nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.57
    ramp.color_ramp.elements[1].position = 0.65
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    cam = nt.nodes.new('ShaderNodeCameraData')
    near = nt.nodes.new('ShaderNodeMapRange')
    near.inputs['From Min'].default_value = 8
    near.inputs['From Max'].default_value = 70
    nt.links.new(cam.outputs['View Distance'], near.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(ramp.outputs['Color'], mul.inputs[0])
    nt.links.new(near.outputs['Result'], mul.inputs[1])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mul.outputs['Value'], mx.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mx.inputs[1])
    nt.links.new(b.outputs['BSDF'], mx.inputs[2])
    nt.links.new(mx.outputs['Shader'], out.inputs['Surface'])
    return m


def plane(name, sx, sy, loc, m):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    # bake the size into the mesh so Object texture coordinates stay in metres
    o.data.transform(__import__('mathutils').Matrix.Diagonal((sx, sy, 1, 1)))
    o.data.materials.append(m)
    return o
