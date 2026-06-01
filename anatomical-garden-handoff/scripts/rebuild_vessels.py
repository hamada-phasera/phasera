"""
Rebuild GLB with realistic anatomical vessels.

Reads existing garden.glb, removes the helical "pasta" vessels (artery_*, vein_*, capillary_*),
keeps spine + leaves, and adds new vessels:
  - 1 anterior longitudinal artery (front of spine, mostly straight, slight S-curve)
  - 1 posterior longitudinal vein (back of spine, slight curve)
  - 10 short radicular branches at vertebral levels (lateral, into spine surface)

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/rebuild_vessels.py
"""
import bpy
import math
import random
import os
from mathutils import Vector

random.seed(42)

INPUT_GLB  = "/Users/hamadahiromu/Desktop/anatomical-garden-handoff/outputs/web-bg/garden.glb"
OUTPUT_GLB = "/Users/hamadahiromu/Desktop/anatomical-garden-handoff/outputs/web-bg/garden.glb"
BACKUP_GLB = "/Users/hamadahiromu/Desktop/anatomical-garden-handoff/outputs/web-bg/garden_pre_vessel_rebuild.glb"

# Backup
if os.path.exists(INPUT_GLB) and not os.path.exists(BACKUP_GLB):
    import shutil
    shutil.copy(INPUT_GLB, BACKUP_GLB)
    print(f"[backup] {BACKUP_GLB}")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=INPUT_GLB)

# ---- Step 1: remove existing helical vessels ----
removed = []
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        continue
    n = o.name.lower()
    if 'artery' in n or 'vein' in n or 'capillary' in n:
        removed.append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
print(f"[step1] removed {len(removed)} old vessels")

# ---- Step 2: identify spine, compute profile ----
spine_meshes = []
leaf_meshes = []
for o in bpy.context.scene.objects:
    if o.type != 'MESH' or not o.data.vertices:
        continue
    if len(o.data.vertices) > 5000:
        spine_meshes.append(o)
    else:
        leaf_meshes.append(o)

if not spine_meshes:
    raise RuntimeError("no spine mesh found (>5000 verts)")
print(f"[step2] spine: {len(spine_meshes)} mesh(es) {[o.name for o in spine_meshes]}")
print(f"        leaves: {len(leaf_meshes)} mesh(es)")

# Gather spine world-space coordinates
all_world = []
for m in spine_meshes:
    M = m.matrix_world
    for v in m.data.vertices:
        all_world.append(M @ v.co)

# Detect vertical axis (largest extent)
mins = [min(v[i] for v in all_world) for i in range(3)]
maxs = [max(v[i] for v in all_world) for i in range(3)]
extents = [maxs[i] - mins[i] for i in range(3)]
vert_ax = extents.index(max(extents))
lat_axes = [i for i in range(3) if i != vert_ax]
ax_names = ['X', 'Y', 'Z']
print(f"        vertical axis: {ax_names[vert_ax]} ({extents[vert_ax]:.3f}m)")

z_min = mins[vert_ax]
z_max = maxs[vert_ax]
spine_h = z_max - z_min

# Build profile: at each height, find center (mean lateral) and max radius
N_SLICES = 24
slices = []
for i in range(N_SLICES):
    z = z_min + (i / (N_SLICES - 1)) * spine_h
    band_h = spine_h / (N_SLICES - 1)
    band = [v for v in all_world if abs(v[vert_ax] - z) < band_h * 0.7]
    if not band:
        continue
    cu = sum(v[lat_axes[0]] for v in band) / len(band)
    cv = sum(v[lat_axes[1]] for v in band) / len(band)
    rs = [math.hypot(v[lat_axes[0]] - cu, v[lat_axes[1]] - cv) for v in band]
    slices.append((z, cu, cv, max(rs)))
print(f"        profile slices: {len(slices)}, mean_r={sum(s[3] for s in slices)/len(slices):.4f}")

def sample_at(z):
    if z <= slices[0][0]:
        return slices[0]
    if z >= slices[-1][0]:
        return slices[-1]
    for i in range(len(slices) - 1):
        z0, u0, v0, r0 = slices[i]
        z1, u1, v1, r1 = slices[i + 1]
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return (z, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, r0 + (r1 - r0) * t)
    return slices[-1]

# Determine "anterior" (front) vs "posterior" (back) directions in lateral plane.
# Pick the lateral axis with smaller extent as anteroposterior axis (spines are
# typically wider laterally than antero-posteriorly). Treat the OTHER lateral as left-right.
lat_extents = [extents[lat_axes[0]], extents[lat_axes[1]]]
ap_axis_idx = lat_axes[0] if lat_extents[0] < lat_extents[1] else lat_axes[1]
lr_axis_idx = lat_axes[1] if ap_axis_idx == lat_axes[0] else lat_axes[0]
print(f"        AP axis: {ax_names[ap_axis_idx]}, LR axis: {ax_names[lr_axis_idx]}")

def make_world_point(z, u_off, v_off):
    """Construct a world-space Vector at the spine slice at height z, offset by (u_off, v_off) in lateral axes."""
    _z, cu, cv, _r = sample_at(z)
    p = [0.0, 0.0, 0.0]
    p[vert_ax] = z
    # lat_axes[0] is u, lat_axes[1] is v
    p[lat_axes[0]] = cu + u_off
    p[lat_axes[1]] = cv + v_off
    return Vector(p)

def make_lateral_offset(amount, ap_sign=0, lr_sign=0):
    """Returns (u_off, v_off) where u/v map onto lat_axes[0] and lat_axes[1]."""
    u_off = 0.0
    v_off = 0.0
    if lat_axes[0] == ap_axis_idx:
        u_off = amount * ap_sign
        v_off = amount * lr_sign
    else:
        u_off = amount * lr_sign
        v_off = amount * ap_sign
    return u_off, v_off

# ---- Step 3: build new vessels ----

def make_curve_mesh(name, points, thickness, color, emit_color, emit_strength, roughness=0.55, metalness=0.05):
    cu = bpy.data.curves.new(name + "_curve", 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = thickness
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for i, pt in enumerate(points):
        bp = sp.bezier_points[i]
        bp.co = pt
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)

    mat = bpy.data.materials.new(name + "_mat")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (300, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (0, 0)
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metalness
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (*emit_color, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    obj.data.materials.append(mat)
    return obj

ART_COLOR = (0.42, 0.06, 0.06)   # dark crimson
ART_EMIT  = (0.78, 0.14, 0.10)
VEIN_COLOR = (0.06, 0.10, 0.30)  # dark navy
VEIN_EMIT  = (0.10, 0.22, 0.55)

# 3a. Anterior longitudinal artery — runs along front of spine
N_PTS = 10
artery_pts = []
for i in range(N_PTS):
    t = i / (N_PTS - 1)
    z = z_min + 0.04 + t * (spine_h - 0.08)
    _, _, _, r = sample_at(z)
    u_off, v_off = make_lateral_offset(r + 0.011, ap_sign=-1)
    # Slight S-shaped lateral wave (very small)
    lr_off = math.sin(t * math.pi * 2) * 0.005
    if lat_axes[0] == lr_axis_idx:
        u_off += lr_off
    else:
        v_off += lr_off
    artery_pts.append(make_world_point(z, u_off, v_off))
make_curve_mesh("artery_anterior_main", artery_pts, thickness=0.0028,
                color=ART_COLOR, emit_color=ART_EMIT, emit_strength=0.40)

# 3b. Posterior longitudinal vein — runs along back of spine
vein_pts = []
for i in range(N_PTS):
    t = i / (N_PTS - 1)
    z = z_min + 0.04 + t * (spine_h - 0.08)
    _, _, _, r = sample_at(z)
    u_off, v_off = make_lateral_offset(r + 0.013, ap_sign=+1)
    lr_off = math.sin(t * math.pi * 2 + 0.5) * 0.006
    if lat_axes[0] == lr_axis_idx:
        u_off += lr_off
    else:
        v_off += lr_off
    vein_pts.append(make_world_point(z, u_off, v_off))
make_curve_mesh("vein_posterior_main", vein_pts, thickness=0.0033,
                color=VEIN_COLOR, emit_color=VEIN_EMIT, emit_strength=0.30)

# 3c. Radicular branches at vertebral levels — short, mostly horizontal
N_BRANCHES = 12
for i in range(N_BRANCHES):
    t = 0.06 + (i / (N_BRANCHES - 1)) * 0.88
    z = z_min + t * spine_h
    _, _, _, r = sample_at(z)
    is_artery = (i % 3) != 2  # 2/3 arteries, 1/3 veins
    side = 1 if (i % 2 == 0) else -1  # alternate left/right

    # Start point (on main vessel)
    if is_artery:
        u_off_s, v_off_s = make_lateral_offset(r + 0.011, ap_sign=-1)
        color, emit, es, thick = ART_COLOR, ART_EMIT, 0.32, 0.0017
    else:
        u_off_s, v_off_s = make_lateral_offset(r + 0.013, ap_sign=+1)
        color, emit, es, thick = VEIN_COLOR, VEIN_EMIT, 0.22, 0.0019

    # End point (toward spine surface, slightly into bone, at vertebral level)
    branch_len = random.uniform(0.025, 0.055)
    u_off_e, v_off_e = make_lateral_offset(r * 0.55, lr_sign=side)

    # Slight Z drift
    z_end = z + random.uniform(-0.012, 0.012)

    start = make_world_point(z, u_off_s, v_off_s)
    end = make_world_point(z_end, u_off_e, v_off_e)
    # Mid-point (gentle bow)
    mid = (start + end) * 0.5
    mid[vert_ax] += random.uniform(-0.004, 0.004)

    make_curve_mesh(
        f"vessel_branch_{'art' if is_artery else 'vein'}_{i:02d}",
        [start, mid, end],
        thickness=thick * random.uniform(0.85, 1.15),
        color=color, emit_color=emit, emit_strength=es,
    )

print(f"[step3] new vessels: 2 longitudinal main + {N_BRANCHES} radicular branches")

# ---- Step 4: export ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUTPUT_GLB,
    export_format='GLB',
    export_yup=True,
    export_apply=False,
    export_materials='EXPORT',
    export_image_format='AUTO',
    use_selection=True,
)
size = os.path.getsize(OUTPUT_GLB) / 1024 / 1024
mesh_count = sum(1 for o in bpy.context.scene.objects if o.type == 'MESH')
print(f"[step4] exported: {OUTPUT_GLB}")
print(f"        size: {size:.2f} MB, total meshes: {mesh_count}")
