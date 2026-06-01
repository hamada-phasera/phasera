"""Convert .blend -> GLB with PROPERLY merged RGBA texture (diff + alpha -> single RGBA PNG).

Strategy: pre-merge diff(RGB) + alpha(R) into one RGBA PNG, then load as a single texture.
This ensures glTF export produces 1 image with embedded alpha channel, which Three.js handles
via alphaTest natively.
"""
import bpy
import sys
import os
from PIL import Image

argv = sys.argv[sys.argv.index("--")+1:]
blend_path, coll_name, out_glb, diff_keyword_excludes_csv = argv[0], argv[1], argv[2], argv[3] if len(argv) > 3 else ""
exclude_words = [w for w in diff_keyword_excludes_csv.split(",") if w]

print(f"Converting {blend_path}#{coll_name} -> {out_glb}")
print(f"  excludes for diff: {exclude_words}")

# Step 1: pre-merge RGBA outside Blender (use PIL on the texture files directly)
tex_dir = os.path.join(os.path.dirname(blend_path), "textures")
print(f"  scanning {tex_dir}")

diff_path = None
alpha_path = None
for f in os.listdir(tex_dir):
    fl = f.lower()
    if "diff" in fl and not any(ex in fl for ex in exclude_words) and (fl.endswith(".jpg") or fl.endswith(".png")):
        diff_path = os.path.join(tex_dir, f)
    elif "alpha" in fl and (fl.endswith(".png") or fl.endswith(".jpg")):
        alpha_path = os.path.join(tex_dir, f)

print(f"  diff: {diff_path}")
print(f"  alpha: {alpha_path}")
assert diff_path, "no diff texture found"

# Open & merge
diff_img = Image.open(diff_path).convert("RGB")
print(f"  diff size: {diff_img.size}")

if alpha_path:
    alpha_img = Image.open(alpha_path).convert("L")  # luminance
    if alpha_img.size != diff_img.size:
        alpha_img = alpha_img.resize(diff_img.size, Image.LANCZOS)
    print(f"  alpha size: {alpha_img.size}")
    # Combine
    merged = diff_img.convert("RGBA")
    merged.putalpha(alpha_img)
else:
    merged = diff_img.convert("RGBA")

# Save merged into a temp PNG next to the blend (Blender can find it easily)
merged_path = os.path.join(tex_dir, "_merged_rgba.png")
merged.save(merged_path, "PNG", optimize=True)
print(f"  merged saved: {merged_path} ({os.path.getsize(merged_path)/1024/1024:.2f} MB)")

# Step 2: now open Blender, build a clean material with this single RGBA texture
bpy.ops.wm.open_mainfile(filepath=blend_path)

target = bpy.data.collections.get(coll_name)
if not target:
    print(f"  collections in scene: {[c.name for c in bpy.data.collections]}")
    sys.exit(1)

# Remove everything not in the target collection
all_objs_in_target = set()
def gather(coll):
    for o in coll.objects:
        all_objs_in_target.add(o)
    for c in coll.children:
        gather(c)
gather(target)

for o in list(bpy.data.objects):
    if o not in all_objs_in_target:
        bpy.data.objects.remove(o, do_unlink=True)

# Make sure target collection is in scene
if target.name not in [c.name for c in bpy.context.scene.collection.children_recursive]:
    try:
        bpy.context.scene.collection.children.link(target)
    except Exception:
        pass

# Load merged texture into Blender
merged_bpy = bpy.data.images.load(merged_path)
merged_bpy.pack()  # pack into .blend so it bakes into GLB

# Rewrite each material to use this single RGBA texture
def rewrite_material(mat):
    if not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial');  out.location = (400, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = merged_bpy
    tx.location = (-300, 0)
    # The single image carries both RGB and Alpha — connect both from the same node
    nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tx.outputs['Alpha'], bsdf.inputs['Alpha'])

    bsdf.inputs['Roughness'].default_value = 0.85
    mat.blend_method = 'CLIP'
    mat.alpha_threshold = 0.5

for mat in bpy.data.materials:
    rewrite_material(mat)
    print(f"  rewrote: {mat.name}")

# Stats
print(f"  images in scene: {len(bpy.data.images)}")
print(f"  objects: {len(bpy.data.objects)}")

# Export
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)

# Cleanup temp file
try:
    os.unlink(merged_path)
except Exception:
    pass

size_mb = os.path.getsize(out_glb) / 1024 / 1024
print(f"  ✓ {out_glb}: {size_mb:.2f} MB")
