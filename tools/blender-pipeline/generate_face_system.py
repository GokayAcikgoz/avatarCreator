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
FaceService = dynamic_import("mpfb.services.faceservice", "FaceService")
ARKIT_FACEUNITS = dynamic_import("mpfb.services.faceservice", "ARKIT_FACEUNITS")

ASSETS_ROOT = r"D:\avatar\.pipeline-tools\asset-packs\extracted"
FACEUNITS_ROOT = os.path.join(ASSETS_ROOT, "targets", "faceunits")
OUT_DIR = r"D:\avatar\public\models\attachments"
BODY_OUT = r"D:\avatar\public\models\avatar-base-poc.glb"
os.makedirs(OUT_DIR, exist_ok=True)

# 9 structural sliders (CLAUDE.md face system). weight is just an authoring-time preview value;
# the app always drives these from 0 at runtime, so the exact number here doesn't matter.
STRUCTURAL_TARGETS = [
    ("head-scale-horiz-incr", "head/head-scale-horiz-incr.target.gz"),
    ("chin-width-incr", "chin/chin-width-incr.target.gz"),
    ("l-cheek-volume-incr", "cheek/l-cheek-volume-incr.target.gz"),
    ("r-cheek-volume-incr", "cheek/r-cheek-volume-incr.target.gz"),
    ("l-eye-scale-incr", "eyes/l-eye-scale-incr.target.gz"),
    ("r-eye-scale-incr", "eyes/r-eye-scale-incr.target.gz"),
    ("l-eye-trans-out", "eyes/l-eye-trans-out.target.gz"),
    ("r-eye-trans-out", "eyes/r-eye-trans-out.target.gz"),
    ("nose-scale-horiz-incr", "nose/nose-scale-horiz-incr.target.gz"),
    ("nose-scale-vert-incr", "nose/nose-scale-vert-incr.target.gz"),
    ("mouth-scale-horiz-incr", "mouth/mouth-scale-horiz-incr.target.gz"),
    ("mouth-upperlip-volume-incr", "mouth/mouth-upperlip-volume-incr.target.gz"),
    ("mouth-lowerlip-volume-incr", "mouth/mouth-lowerlip-volume-incr.target.gz"),
]

FACIAL_PARTS = [
    ("body_eyes_lowpoly.glb", "eyes/low-poly/low-poly.mhclo", "Eyes"),
    ("body_eyebrows_001.glb", "eyebrows/eyebrow001/eyebrow001.mhclo", "Eyebrows"),
    ("body_eyelashes_001.glb", "eyelashes/eyelashes01/eyelashes01.mhclo", "Eyelashes"),
    ("body_teeth_base.glb", "teeth/teeth_base/teeth_base.mhclo", "Teeth"),
    ("body_tongue_01.glb", "tongue/tongue01/tongue01.mhclo", "Tongue"),
]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def export_selection(objects, glb_path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_morph=True,
        export_skins=True,
        export_yup=True,
        export_image_format="WEBP",
        export_image_quality=82,
    )
    print(f"[face] wrote {glb_path} ({os.path.getsize(glb_path)} bytes)")


clear_scene()
basemesh = HumanService.create_human()
rig = HumanService.add_builtin_rig(basemesh, "default")
print(f"[face] basemesh + rig ready, bones={len(rig.data.bones)}")

targets_root = LocationService.get_mpfb_data("targets")
for label, rel_path in STRUCTURAL_TARGETS:
    path = os.path.join(targets_root, rel_path)
    if not os.path.exists(path):
        print(f"[face] MISSING structural target {label}: {path}")
        continue
    TargetService.load_target(basemesh, path, weight=0.0)
print(f"[face] loaded {len(STRUCTURAL_TARGETS)} structural sliders")

arkit_loaded = 0
for name in ARKIT_FACEUNITS:
    path = os.path.join(FACEUNITS_ROOT, f"{name}.target")
    if not os.path.exists(path):
        print(f"[face] MISSING arkit unit: {path}")
        continue
    TargetService.load_target(basemesh, path, weight=0.0)
    arkit_loaded += 1
print(f"[face] loaded {arkit_loaded}/{len(ARKIT_FACEUNITS)} ARKit face units")

facial_asset_objs = []
for filename, rel_path, asset_type in FACIAL_PARTS:
    mhclo_path = os.path.join(ASSETS_ROOT, rel_path)
    asset_obj = HumanService.add_mhclo_asset(
        mhclo_path, basemesh, asset_type=asset_type, subdiv_levels=0, material_type="GAMEENGINE"
    )
    facial_asset_objs.append((filename, asset_obj))
    print(f"[face] equipped {asset_type} -> {asset_obj.name if asset_obj else None}")

# Propagate viseme/ARKit shape keys from the basemesh onto eyes/eyebrows/eyelashes/teeth/tongue so
# blinking and expressions keep them visually in sync with the face (see docs/asset-pipeline.md —
# this does NOT propagate the 9 structural sliders, only viseme/ARKit-named shape keys).
FaceService.interpolate_targets(basemesh)
print("[face] interpolated ARKit/viseme shape keys onto facial part proxies")

# Permanent (pipeline-level, not runtime-workaround) fix for foot/ankle z-fighting: both of our
# current shoe assets ship real delete_verts data, so temporarily equipping them creates real MASK
# modifiers on the basemesh that bake_modifiers_remove_helpers(bake_masks=True) below will bake into
# the exported body permanently, hiding foot skin under EITHER shoe choice. Our shirt/pants assets
# were checked and do NOT ship delete_verts data (confirmed via .pipeline-tools/test_mask_union.py)
# — polygonOffset in AttachmentPart.tsx remains the fix for those until better-authored assets
# replace them; see docs/asset-pipeline.md.
SHOE_PATHS_FOR_MASKING = [
    "clothes/toigo_mj_cloth_shoes/toigo_mj_cloth_shoes.mhclo",
    "clothes/toigo_ankle_boots_male/toigo_ankle_boots_male.mhclo",
]
temp_shoe_objs = []
for rel in SHOE_PATHS_FOR_MASKING:
    obj = HumanService.add_mhclo_asset(
        os.path.join(ASSETS_ROOT, rel), basemesh, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE"
    )
    temp_shoe_objs.append(obj)
print(f"[face] temporarily equipped {len(temp_shoe_objs)} shoe(s) for permanent foot mask")

# --- Export body ---
body_export_root = ExportService.create_character_copy(basemesh, name_suffix="_export")
body_export_mesh = ObjectService.find_object_of_type_amongst_nearest_relatives(body_export_root, "Basemesh")
ExportService.bake_modifiers_remove_helpers(
    body_export_mesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=True
)
export_selection([body_export_root, body_export_mesh], BODY_OUT)

# clean up body export copy before exporting facial parts, so it doesn't interfere with selection
bpy.ops.object.select_all(action="DESELECT")
body_export_root.select_set(True)
for child in ObjectService.get_list_of_children(body_export_root):
    child.select_set(True)
bpy.ops.object.delete()

# Remove the temp shoes from the *original* basemesh too — they were only equipped for their
# mask side effect on the body export above, and must not leak into the facial-part exports below.
bpy.ops.object.select_all(action="DESELECT")
for obj in temp_shoe_objs:
    obj.select_set(True)
bpy.ops.object.delete()

# --- Export each facial completeness part (now carrying interpolated ARKit shape keys) ---
for filename, asset_obj in facial_asset_objs:
    original_name = asset_obj.name
    export_root = ExportService.create_character_copy(asset_obj, name_suffix="_export")
    export_asset = None
    for child in ObjectService.get_list_of_children(export_root):
        if child.type == "MESH" and child.name.startswith(original_name):
            export_asset = child
            break
    if export_asset is None:
        print(f"[face] WARNING could not find export copy of {original_name}, skipping")
        continue
    glb_path = os.path.join(OUT_DIR, filename)
    export_selection([export_root, export_asset], glb_path)
    bpy.ops.object.select_all(action="DESELECT")
    export_root.select_set(True)
    for child in ObjectService.get_list_of_children(export_root):
        child.select_set(True)
    bpy.ops.object.delete()

print("[face] ALL DONE")
