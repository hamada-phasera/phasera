"""Quick Eevee preview render of the final scene to verify visually."""
import bpy
import os
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/claude/garden_final.glb")

# Camera
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 50
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
cam.location = (1.6, -2.2, 0.85)
# Add empty as look-at target
target = bpy.data.objects.new("LookAtTarget", None)
bpy.context.scene.collection.objects.link(target)
target.location = (0, 0, 0.75)
# Track to constraint
constraint = cam.constraints.new(type='TRACK_TO')
constraint.target = target
constraint.track_axis = 'TRACK_NEGATIVE_Z'
constraint.up_axis = 'UP_Y'
bpy.context.scene.camera = cam

# Lights
def add_sun(name, location, rot_euler, energy, color):
    light_data = bpy.data.lights.new(name, type='SUN')
    light_data.energy = energy
    light_data.color = color
    light = bpy.data.objects.new(name, light_data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = rot_euler

add_sun("key", (3, -2, 4), (0.7, 0.3, 0.5), 4.0, (1.0, 0.95, 0.85))
add_sun("fill", (-3, -1, 2), (1.1, -0.4, 1.2), 1.5, (0.6, 0.7, 0.95))
add_sun("rim", (-1, 3, 3), (-0.8, 0.2, 1.5), 2.5, (1.0, 0.5, 0.65))

# World
if not bpy.context.scene.world:
    bpy.context.scene.world = bpy.data.worlds.new("W")
world = bpy.context.scene.world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.04, 0.04, 0.06, 1.0)
    bg.inputs[1].default_value = 1.0

# Eevee settings
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.taa_render_samples = 32
scene.eevee.use_bloom = True
scene.eevee.bloom_intensity = 0.1
scene.eevee.use_ssr = True

scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = "/home/claude/preview_garden.png"

scene.view_settings.view_transform = 'Filmic'
scene.view_settings.look = 'Medium High Contrast'
scene.view_settings.exposure = 0.3

bpy.ops.render.render(write_still=True)
print(f"Preview: {scene.render.filepath}")
print(f"Size: {os.path.getsize(scene.render.filepath)/1024:.1f} KB")
