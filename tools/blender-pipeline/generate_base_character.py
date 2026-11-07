import importlib
import sys
import os
import bpy


def dynamic_import(absolute_package_str, key):
    for amod in sys.modules:
        if amod.endswith(absolute_package_str):
            mpfb_mod = importlib.import_module(amod)
            if not hasattr(mpfb_mod, key):
                raise AttributeError(f"Module {amod} does not have attribute {key}")
            return getattr(mpfb_mod, key)
    raise ValueError(f"No module found with name ending in {absolute_package_str}")


HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")
LocationService = dynamic_import("mpfb.services.locationservice", "LocationService")
ExportService = dynamic_import("mpfb.services.exportservice", "ExportService")
ObjectService = dynamic_import("mpfb.services.objectservice", "ObjectService")

# clear default scene
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

basemesh = HumanService.create_human()
print(f"[poc] created basemesh: {basemesh.name}, verts={len(basemesh.data.vertices)}")

targets_root = LocationService.get_mpfb_data("targets")

morph_plan = [
    ("FaceWidth", os.path.join(targets_root, "head", "head-scale-horiz-incr.target.gz"), 0.7),
    ("JawWidth", os.path.join(targets_root, "chin", "chin-width-incr.target.gz"), 0.7),
    ("EyeSize_L", os.path.join(targets_root, "eyes", "l-eye-scale-incr.target.gz"), 0.8),
    ("EyeSize_R", os.path.join(targets_root, "eyes", "r-eye-scale-incr.target.gz"), 0.8),
]

for label, path, weight in morph_plan:
    if not os.path.exists(path):
        print(f"[poc] MISSING target for {label}: {path}")
        continue
    TargetService.load_target(basemesh, path, weight=weight)
    print(f"[poc] applied {label} <- {os.path.basename(path)} @ {weight}")

shape_keys = basemesh.data.shape_keys.key_blocks.keys() if basemesh.data.shape_keys else []
print(f"[poc] shape keys on basemesh after morphs: {list(shape_keys)}")

rig = HumanService.add_builtin_rig(basemesh, "default")
print(f"[poc] added rig: {rig.name if rig else None}, bone count={len(rig.data.bones) if rig else 0}")

export_root = ExportService.create_character_copy(basemesh, name_suffix="_export")
export_basemesh = ObjectService.find_object_of_type_amongst_nearest_relatives(export_root, "Basemesh")
ExportService.bake_modifiers_remove_helpers(
    export_basemesh,
    bake_masks=True,
    bake_subdiv=False,
    remove_helpers=True,
    also_proxy=True,
)
print(f"[poc] export copy root: {export_root.name}, export basemesh verts={len(export_basemesh.data.vertices)}")

out_dir = r"D:\avatar\public\models"
os.makedirs(out_dir, exist_ok=True)
glb_path = os.path.join(out_dir, "avatar-base-poc.glb")

bpy.ops.object.select_all(action="DESELECT")
export_root.select_set(True)
for child in ObjectService.get_list_of_children(export_root):
    child.select_set(True)
bpy.context.view_layer.objects.active = export_root

bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_morph=True,
    export_skins=True,
    export_yup=True,
)

print(f"[poc] WROTE {glb_path}")
print(f"[poc] file size = {os.path.getsize(glb_path)} bytes")
