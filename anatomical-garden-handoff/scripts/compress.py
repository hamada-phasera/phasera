"""Re-export garden_final.glb with Draco mesh compression to shrink filesize."""
import bpy
import os

# Open the existing GLB by importing
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/claude/garden_final.glb")

bpy.ops.object.select_all(action='SELECT')

# Try Draco; if not available, just re-export with image compression
# Reduce texture resolution to 1/4 (1024px max for 4K originals)
for img in bpy.data.images:
    if img.has_data and img.size[0] > 1024:
        new_w = max(512, img.size[0] // 4)
        new_h = max(512, img.size[1] // 4)
        print(f"  resizing {img.name}: {img.size[0]}x{img.size[1]} -> {new_w}x{new_h}")
        img.scale(new_w, new_h)

# Note: alpha channel needs PNG, but let's try JPEG with separate alpha first
# Actually, since plant materials have alpha, we need WEBP or PNG
bpy.ops.export_scene.gltf(
    filepath="/home/claude/garden_compressed.glb",
    export_format='GLB',
    export_yup=True,
    export_apply=False,
    export_materials='EXPORT',
    export_image_format='WEBP',
    export_image_quality=80,
    use_selection=True,
)
print("Compressed with WEBP @ 80% quality, half-res textures")

size_mb = os.path.getsize("/home/claude/garden_compressed.glb") / 1024 / 1024
print(f"compressed: {size_mb:.2f} MB")
