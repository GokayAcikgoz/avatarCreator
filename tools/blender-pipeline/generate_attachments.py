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
ExportService = dynamic_import("mpfb.services.exportservice", "ExportService")
ObjectService = dynamic_import("mpfb.services.objectservice", "ObjectService")

ASSETS_ROOT = r"D:\avatar\.pipeline-tools\asset-packs\extracted"
# Raw (uncompressed) exports land here; tools/asset-pipeline/postprocess_attachments.mjs then
# writes the meshopt-compressed browser copy (public/models/attachments) and the uncompressed
# Blender-importable server copy (api/server-assets/attachments) from this single source.
OUT_DIR = r"D:\avatar\.pipeline-tools\raw-attachments"
os.makedirs(OUT_DIR, exist_ok=True)

# Optional: `blender --background --python generate_attachments.py -- hair_bun.glb,top_tank.glb`
# regenerates only the listed outputs instead of the whole catalog.
ONLY = set()
if "--" in sys.argv:
    tail = sys.argv[sys.argv.index("--") + 1:]
    if tail:
        ONLY = {name.strip() for name in tail[0].split(",") if name.strip()}

# Body-completeness parts (eyes/eyebrows/eyelashes/teeth/tongue) are NOT listed here — they are
# owned by generate_face_system.py, which additionally propagates ARKit expression shape keys onto
# them via FaceService.interpolate_targets(). Exporting them from this script would silently
# overwrite that with a version carrying no expression shape keys. Always re-run
# generate_face_system.py after this script if both were touched.
# (output filename, mhclo relative path, asset_type for MPFB, subdiv_levels)
ATTACHMENTS = [
    ("hair_short_bob.glb", "hair/toigo_blunt_bob/toigo_blunt_bob.mhclo", "Hair", 0),
    ("hair_long.glb", "hair/o4saken_long01/o4saken_long01.mhclo", "Hair", 0),
    ("hair_braided.glb", "hair/elvs_double_mh_braid/elvs_double_mh_braid.mhclo", "Hair", 0),
    ("hair_short_messy.glb", "hair/cortu_short_messy_hair/cortu_short_messy_hair.mhclo", "Hair", 0),
    ("hair_crop.glb", "hair/culturalibre_hair_02/culturalibre_hair_02.mhclo", "Hair", 0),
    ("hair_swept.glb", "hair/culturalibre_hair_05/culturalibre_hair_05.mhclo", "Hair", 0),
    ("hair_long_straight.glb", "hair/culturalibre_hair_01/culturalibre_hair_01.mhclo", "Hair", 0),
    ("hair_bun.glb", "hair/rehmanpolanski_hair_bun_brown/rehmanpolanski_hair_bun_brown.mhclo", "Hair", 0),
    ("hair_shaggy.glb", "hair/faydaen_hair_1/faydaen_hair_1.mhclo", "Hair", 0),
    ("hair_bob_bangs.glb", "hair/toigo_curled_under_bob_with_bangs/toigo_curled_under_bob_with_bangs.mhclo", "Hair", 0),
    ("hair_bowl.glb", "hair/littleright_bobcut_hair/littleright_bobcut_hair.mhclo", "Hair", 0),
    ("top_tshirt.glb", "clothes/toigo_basic_tucked_t-shirt/toigo_basic_tucked_t-shirt.mhclo", "Clothes", 0),
    ("top_polo.glb", "clothes/namuhekam_male_polo_shirt/namuhekam_male_polo_shirt.mhclo", "Clothes", 0),
    ("top_crew_tee.glb", "clothes/elvs_crude_t-shirt_male/elvs_crude_t-shirt_male.mhclo", "Clothes", 0),
    ("top_sweater.glb", "clothes/toigo_fisherman_sweater/toigo_fisherman_sweater.mhclo", "Clothes", 0),
    ("top_tank.glb", "clothes/toigo_keyhole_tank_top/toigo_keyhole_tank_top.mhclo", "Clothes", 0),
    ("top_camisole.glb", "clothes/toigo_camisole_top/toigo_camisole_top.mhclo", "Clothes", 0),
    ("bottom_wool_pants.glb", "clothes/toigo_wool_pants/toigo_wool_pants.mhclo", "Clothes", 0),
    ("bottom_cargo_pants.glb", "clothes/cortu_cargo_pants/cortu_cargo_pants.mhclo", "Clothes", 0),
    ("bottom_denim_shorts.glb", "clothes/cortu_jeans_shorts/cortu_jeans_shorts.mhclo", "Clothes", 0),
    ("bottom_harem_pants.glb", "clothes/toigo_harem_pants/toigo_harem_pants.mhclo", "Clothes", 0),
    ("shoes_cloth.glb", "clothes/toigo_mj_cloth_shoes/toigo_mj_cloth_shoes.mhclo", "Clothes", 0),
    ("shoes_ankle_boots.glb", "clothes/toigo_ankle_boots_male/toigo_ankle_boots_male.mhclo", "Clothes", 0),
    ("shoes_leather_boots.glb", "clothes/culturalibre_male_boots/culturalibre_male_boots.mhclo", "Clothes", 0),
    ("shoes_rain_boots.glb", "clothes/culturalibre_hero_boots_2/culturalibre_hero_boots_2.mhclo", "Clothes", 0),
    ("hat_newsboy_cap.glb", "clothes/jujube_newsboy_cap/jujube_newsboy_cap.mhclo", "Clothes", 0),
    ("hat_bucket.glb", "clothes/aethelraed_unraed_cloche_hat/aethelraed_unraed_cloche_hat.mhclo", "Clothes", 0),
    ("hat_santa.glb", "clothes/joepal_xmas_cap/joepal_xmas_cap.mhclo", "Clothes", 0),
    ("glasses_optical.glb", "clothes/kwnet_at_optical_glasses/kwnet_at_optical_glasses.mhclo", "Clothes", 0),
    ("glasses_wayfarer.glb", "clothes/spamrakuen_tbm_glasses_frames_01/spamrakuen_tbm_glasses_frames_01.mhclo", "Clothes", 0),
    ("glasses_round.glb", "clothes/toigo_round_glasses_leopard/toigo_round_glasses_leopard.mhclo", "Clothes", 0),
    ("glasses_sunglasses.glb", "clothes/frankyaye_glasses_library_male/frankyaye_glasses_library_male.mhclo", "Clothes", 0),
    ("glasses_rectangle.glb", "clothes/spamrakuen_sagerfrogs_glasses_02/spamrakuen_sagerfrogs_glasses_02.mhclo", "Clothes", 0),
    ("glasses_3d.glb", "clothes/ews_3d_glasses/ews_3d_glasses.mhclo", "Clothes", 0),
]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def export_one(basemesh, rig, asset_obj, filename):
    original_asset_name = asset_obj.name
    export_root = ExportService.create_character_copy(asset_obj, name_suffix="_export")
    export_asset = None
    for child in ObjectService.get_list_of_children(export_root):
        if child.type == "MESH" and child.name.startswith(original_asset_name):
            export_asset = child
            break
    if export_asset is None:
        raise RuntimeError(f"Could not find exported copy of asset '{original_asset_name}' among {[c.name for c in ObjectService.get_list_of_children(export_root)]}")

    glb_path = os.path.join(OUT_DIR, filename)
    bpy.ops.object.select_all(action="DESELECT")
    export_root.select_set(True)
    if export_asset:
        export_asset.select_set(True)
    bpy.context.view_layer.objects.active = export_root

    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_morph=False,
        export_skins=True,
        export_yup=True,
        export_image_format="WEBP",
        export_image_quality=82,
    )
    print(f"[attach] wrote {glb_path} ({os.path.getsize(glb_path)} bytes)")

    # clean up export copy so it doesn't pile up in the scene / get re-selected next export
    bpy.ops.object.select_all(action="DESELECT")
    export_root.select_set(True)
    for child in ObjectService.get_list_of_children(export_root):
        child.select_set(True)
    bpy.ops.object.delete()


for filename, rel_path, asset_type, subdiv in ATTACHMENTS:
    if ONLY and filename not in ONLY:
        continue
    clear_scene()
    basemesh = HumanService.create_human()
    rig = HumanService.add_builtin_rig(basemesh, "default")

    mhclo_path = os.path.join(ASSETS_ROOT, rel_path)
    if not os.path.exists(mhclo_path):
        print(f"[attach] MISSING {mhclo_path}, skipping")
        continue

    asset_obj = HumanService.add_mhclo_asset(
        mhclo_path,
        basemesh,
        asset_type=asset_type,
        subdiv_levels=subdiv,
        material_type="GAMEENGINE",
    )
    print(f"[attach] equipped {rel_path} -> {asset_obj.name if asset_obj else None}")

    export_one(basemesh, rig, asset_obj, filename)

print("[attach] ALL DONE")
