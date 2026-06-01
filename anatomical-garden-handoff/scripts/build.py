"""Anatomical Garden v3 — Decay & Invasion.

Design: spine is the sole subject. Plants ERUPT from gaps between vertebrae.
Capillary blood vessels CRAWL along the bone surface. No floor flora.

Pipeline:
1. Spine: import & normalize, height = 1.5m
2. Surface sampling: pick N points on spine mesh (face normals + face areas)
3. Leaves: for each leaf-spawn point, instance ONE small leaf mesh oriented along the surface normal
4. Capillaries: build helix-tube curves THAT FOLLOW the spine's vertical extent,
   passing very close to the spine surface (radius slightly larger than spine cross-section at each height)

Approach for capillaries:
- Sample the spine's silhouette at vertical slices (every 5cm in Z) to get a profile radius
- Generate helix curves whose radius = local profile radius + small offset
- Result: the capillaries hug the bone

Approach for leaves:
- Sample triangle barycenters on the spine
- Filter by face normal (only outward-pointing horizontal-ish faces — not bottom)
- For each spawn point, place a small leaf with rotation aligned to the face normal
"""
import bpy
import sys
import os
import math
import random
from mathutils import Vector, Matrix, Quaternion

random.seed(7)

OUT_GLB = "/home/claude/garden_final.glb"
SPINE_GLTF = "/home/claude/assets/spine/scene.gltf"
NETTLE_GLB = "/home/claude/nettle.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)

# ============================================================
# 1. Spine — import & normalize
# ============================================================
print("\n=== 1. Spine ===")
bpy.ops.import_scene.gltf(filepath=SPINE_GLTF)
spine_meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print(f"  {len(spine_meshes)} mesh(es)")

bpy.context.view_layer.update()
all_corners = []
for o in spine_meshes:
    for c in o.bound_box:
        all_corners.append(o.matrix_world @ Vector(c))
min_corner = Vector((min(c.x for c in all_corners), min(c.y for c in all_corners), min(c.z for c in all_corners)))
max_corner = Vector((max(c.x for c in all_corners), max(c.y for c in all_corners), max(c.z for c in all_corners)))
size = max_corner - min_corner
center = (min_corner + max_corner) * 0.5
sizes = [size.x, size.y, size.z]
long_axis = sizes.index(max(sizes))

target_height = 1.5
T_translate = Matrix.Translation(-center)
if long_axis == 0:
    R_align = Matrix.Rotation(math.radians(90), 4, 'Y')
elif long_axis == 1:
    R_align = Matrix.Rotation(math.radians(-90), 4, 'X')
else:
    R_align = Matrix.Identity(4)
scale_factor = target_height / max(sizes)
S_scale = Matrix.Scale(scale_factor, 4)

final_T = S_scale @ R_align @ T_translate
for o in spine_meshes:
    M_old = o.matrix_world.copy()
    full_M = final_T @ M_old
    for v in o.data.vertices:
        v.co = full_M @ v.co
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    o.data.update()

bpy.context.view_layer.update()
all_corners = []
for o in spine_meshes:
    for c in o.bound_box:
        all_corners.append(o.matrix_world @ Vector(c))
z_offset = -min(c.z for c in all_corners)
for o in spine_meshes:
    for v in o.data.vertices:
        v.co.z += z_offset
    o.data.update()
bpy.context.view_layer.update()
print(f"  spine: height={target_height}m, base at Z=0")

# Bone material — slightly more contrasted bone color
for o in spine_meshes:
    for slot in o.material_slots:
        if slot.material and slot.material.use_nodes:
            for n in slot.material.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    n.inputs['Base Color'].default_value = (0.86, 0.80, 0.68, 1.0)
                    n.inputs['Roughness'].default_value = 0.55

# ============================================================
# 2. Compute spine surface profile (radius vs height)
# ============================================================
print("\n=== 2. Spine surface profile ===")
# For each Z slice, find max radial distance from Z axis among all spine verts
N_SLICES = 30
Z_MIN, Z_MAX = 0.05, target_height - 0.05
slice_dz = (Z_MAX - Z_MIN) / (N_SLICES - 1)
profile = []  # list of (z, max_r, mean_r)
spine_verts_world = []
for o in spine_meshes:
    for v in o.data.vertices:
        spine_verts_world.append(o.matrix_world @ v.co)

for i in range(N_SLICES):
    z = Z_MIN + i * slice_dz
    z_band = slice_dz  # half-band thickness above and below
    band_verts = [v for v in spine_verts_world if abs(v.z - z) < z_band]
    if not band_verts:
        profile.append((z, 0.13, 0.10))
        continue
    radii = [math.hypot(v.x, v.y) for v in band_verts]
    profile.append((z, max(radii), sum(radii)/len(radii)))

print(f"  profile: {N_SLICES} slices, max_r range = {min(p[1] for p in profile):.3f}—{max(p[1] for p in profile):.3f}")

def sample_profile(z):
    """Get (max_r, mean_r) at any height by linear interpolation."""
    if z <= profile[0][0]: return (profile[0][1], profile[0][2])
    if z >= profile[-1][0]: return (profile[-1][1], profile[-1][2])
    for i in range(len(profile) - 1):
        z0, mr0, ar0 = profile[i]
        z1, mr1, ar1 = profile[i+1]
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return (mr0 + (mr1-mr0)*t, ar0 + (ar1-ar0)*t)
    return (profile[-1][1], profile[-1][2])

# ============================================================
# 3. Capillary network — multiple thin curves hugging the spine
# ============================================================
print("\n=== 3. Capillaries ===")

def make_capillary(name, z_start, z_end, n_turns, direction, color, emit, thickness, radius_offset, n_points=120):
    """Build a curve whose radius at each Z follows the spine profile + offset."""
    verts = []
    for i in range(n_points):
        t = i / (n_points - 1)
        z = z_start + (z_end - z_start) * t
        max_r, mean_r = sample_profile(z)
        # Capillary clings just outside the bone surface
        r = max_r + radius_offset + 0.005 * math.sin(t * math.pi * 8)
        # Spiral angle
        angle = direction * (n_turns * 2 * math.pi * t) + random.uniform(0, 2*math.pi)
        # Slight random wobble for organic feel
        angle_jitter = 0.15 * math.sin(t * math.pi * 11)
        x = math.cos(angle + angle_jitter) * r
        y = math.sin(angle + angle_jitter) * r
        verts.append((x, y, z))

    curve_data = bpy.data.curves.new(name + "_curve", type='CURVE')
    curve_data.dimensions = '3D'
    curve_data.bevel_depth = thickness
    curve_data.bevel_resolution = 3
    curve_data.use_fill_caps = True
    spline = curve_data.splines.new('BEZIER')
    spline.bezier_points.add(len(verts) - 1)
    for i, v in enumerate(verts):
        bp = spline.bezier_points[i]
        bp.co = v
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'

    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)

    mat = bpy.data.materials.new(name + "_mat")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial');  out.location = (300, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (0, 0)
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = 0.4
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = emit
        bsdf.inputs['Emission Strength'].default_value = 0.6
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    obj.data.materials.append(mat)
    return obj

# Many thin capillaries, varied lengths
ARTERY_COL = (0.82, 0.20, 0.20, 1.0)
ARTERY_EMIT = (0.95, 0.18, 0.18, 1.0)
VEIN_COL = (0.16, 0.32, 0.68, 1.0)
VEIN_EMIT = (0.18, 0.45, 0.95, 1.0)

# Main arteries — 2 long, very thin, NEAR-VERTICAL with gentle curve
for i in range(2):
    z_s = 0.10 + random.uniform(-0.02, 0.02)
    z_e = 1.42 + random.uniform(-0.02, 0.02)
    make_capillary(f"artery_main_{i}", z_s, z_e, n_turns=0.4, direction=1,
                   color=ARTERY_COL, emit=ARTERY_EMIT, thickness=0.004,
                   radius_offset=0.005)

# Main veins — 2 long, opposite side
for i in range(2):
    z_s = 0.08 + random.uniform(-0.02, 0.02)
    z_e = 1.40 + random.uniform(-0.02, 0.02)
    make_capillary(f"vein_main_{i}", z_s, z_e, n_turns=0.4, direction=-1,
                   color=VEIN_COL, emit=VEIN_EMIT, thickness=0.005,
                   radius_offset=0.008)

# Short partial capillaries — fewer, scattered
for i in range(6):
    z_s = random.uniform(0.10, 1.20)
    z_e = z_s + random.uniform(0.08, 0.20)
    z_e = min(z_e, 1.45)
    is_artery = random.random() < 0.5
    color = ARTERY_COL if is_artery else VEIN_COL
    emit = ARTERY_EMIT if is_artery else VEIN_EMIT
    direction = 1 if random.random() < 0.5 else -1
    make_capillary(
        f"capillary_{i}",
        z_s, z_e,
        n_turns=random.uniform(0.1, 0.4),
        direction=direction,
        color=color, emit=emit,
        thickness=random.uniform(0.0020, 0.0035),
        radius_offset=random.uniform(0.003, 0.012)
    )

print(f"  total capillaries: 4 main + 6 fragments")

# ============================================================
# 4. Leaves erupting from spine surface
# ============================================================
print("\n=== 4. Leaves erupting ===")

# Import nettle, get individual leaf variations as templates
before = set(o.name for o in bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=NETTLE_GLB)
after = set(o.name for o in bpy.data.objects)
nettle_new = [bpy.data.objects[n] for n in (after - before) if bpy.data.objects[n].type == 'MESH']
print(f"  nettle imported: {len(nettle_new)} variations")

# Bake transforms and move templates aside
TEMPLATE_OFFSET = Vector((100.0, 100.0, -100.0))
nettle_templates = []
for o in nettle_new:
    M = o.matrix_world.copy()
    for v in o.data.vertices:
        v.co = M @ v.co
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    # measure
    coords = [v.co for v in o.data.vertices]
    if not coords: continue
    h = max(c.z for c in coords) - min(c.z for c in coords)
    print(f"    {o.name}: h={h:.3f}m")
    nettle_templates.append(o)
    # Move aside
    for v in o.data.vertices:
        v.co += TEMPLATE_OFFSET
    o.data.update()

# Sample spawn points on spine mesh
print(f"  Sampling spawn points on spine...")
N_LEAVES = 80  # leaves bursting from bone — balanced

def sample_face_points(meshes, n, normal_filter=None):
    """Sample n face-barycenter points on the given meshes, weighted by face area.

    Returns list of (world_position, world_normal).
    normal_filter: callable(normal_world) -> bool. Reject sample if False.
    """
    # Collect all face data: (area, world_center, world_normal)
    samples_pool = []
    for m in meshes:
        M = m.matrix_world
        Mrot = M.to_3x3()
        for poly in m.data.polygons:
            verts = [m.data.vertices[i].co for i in poly.vertices]
            world_verts = [M @ v for v in verts]
            center = sum(world_verts, Vector()) / len(world_verts)
            nrm = (Mrot @ poly.normal).normalized()
            area = poly.area  # in local coords; close enough since uniform scale
            samples_pool.append((area, center, nrm))
    
    # Filter
    if normal_filter:
        samples_pool = [s for s in samples_pool if normal_filter(s[2])]
    
    # Weighted random sample
    if not samples_pool:
        return []
    total_area = sum(s[0] for s in samples_pool)
    chosen = []
    for _ in range(n):
        r = random.uniform(0, total_area)
        cum = 0
        for area, pos, nrm in samples_pool:
            cum += area
            if cum >= r:
                # Slight randomness around the chosen face
                chosen.append((pos, nrm))
                break
    return chosen

# Filter: only outward-pointing faces (positive horizontal normal component, not pointing straight up/down)
def normal_filter(n_world):
    horiz = math.hypot(n_world.x, n_world.y)
    # Want faces where horizontal component is dominant (pointing outward)
    # Reject pure top (n.z > 0.85) or pure bottom (n.z < -0.85)
    if abs(n_world.z) > 0.7:
        return False
    return horiz > 0.3

spawn_points = sample_face_points(spine_meshes, N_LEAVES, normal_filter)
print(f"  collected {len(spawn_points)} spawn points")

# For each spawn point, place a small leaf
def place_leaf(template, position, normal, target_height):
    """Duplicate template, scale to TARGET HEIGHT (meters), orient along surface normal."""
    new_obj = template.copy()
    new_obj.data = template.data.copy()
    bpy.context.scene.collection.objects.link(new_obj)
    
    # Step 1: undo template offset
    coords = [v.co - TEMPLATE_OFFSET for v in new_obj.data.vertices]
    if not coords:
        bpy.data.objects.remove(new_obj, do_unlink=True)
        return None
    min_z = min(c.z for c in coords)
    cx = sum(c.x for c in coords) / len(coords)
    cy = sum(c.y for c in coords) / len(coords)
    # Step 3: shift so base center is at origin, bottom at Z=0
    shifted = [Vector((c.x - cx, c.y - cy, c.z - min_z)) for c in coords]
    # Step 4: compute actual scale factor from target_height
    src_h = max(c.z for c in shifted) - min(c.z for c in shifted)
    if src_h <= 0:
        bpy.data.objects.remove(new_obj, do_unlink=True)
        return None
    actual_scale = target_height / src_h
    
    # Build orientation: leaf's original +Z should align with the surface normal
    up = Vector((0, 0, 1))
    if abs(normal.dot(up)) > 0.999:
        rot = Quaternion()
    else:
        axis = up.cross(normal).normalized()
        angle = math.acos(max(-1, min(1, up.dot(normal))))
        rot = Quaternion(axis, angle)
    R = rot.to_matrix()
    
    # Random Z-axis spin around the leaf's own up (the surface normal) for variation
    spin_angle = random.uniform(0, 2 * math.pi)
    spin = Quaternion(normal, spin_angle)
    R_total = (spin @ rot).to_matrix()
    
    # Apply: scale, rotate, translate
    for i, v in enumerate(new_obj.data.vertices):
        local = shifted[i] * actual_scale
        rotated = R_total @ local
        v.co = rotated + position
    new_obj.data.update()
    
    new_obj.matrix_world = Matrix.Identity(4)
    return new_obj

# Place leaves at varying TARGET HEIGHTS (meters) — these are leaf clusters bursting from bone
LEAF_HEIGHT_RANGE = (0.12, 0.28)  # 12-28cm leaf clusters - clearly visible against the bone
NORMAL_PUSH = 0.02  # push spawn point slightly outward so leaf base sits ON the surface
for i, (pos, nrm) in enumerate(spawn_points):
    template = random.choice(nettle_templates)
    h = random.uniform(*LEAF_HEIGHT_RANGE)
    pushed_pos = pos + nrm * NORMAL_PUSH
    place_leaf(template, pushed_pos, nrm, h)

# Remove templates
for t in nettle_templates:
    bpy.data.objects.remove(t, do_unlink=True)

print(f"  placed {len(spawn_points)} leaf clusters on spine surface")

# ============================================================
# 5. Export
# ============================================================
print("\n=== 5. Export ===")
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format='GLB',
    export_yup=True,
    export_apply=False,
    export_materials='EXPORT',
    export_image_format='AUTO',
    use_selection=True,
)

mesh_count = sum(1 for o in bpy.data.objects if o.type == 'MESH')
total_polys = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH' and o.data)
size_mb = os.path.getsize(OUT_GLB) / 1024 / 1024
print(f"  ✓ {OUT_GLB}: {size_mb:.2f} MB / {mesh_count} meshes / {total_polys:,} polys")
