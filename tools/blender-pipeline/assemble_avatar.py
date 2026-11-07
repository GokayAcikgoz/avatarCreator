"""
Runtime avatar assembly for the API (AvatarConfiguration -> AssetResolver -> THIS -> GLB/PNG).

Not the asset-authoring pipeline: this takes already-authored GLBs (body + selected hair,
clothing, facial hair, accessories + always-on face parts) and assembles ONE avatar per request,
reproducing what the web viewer shows:

  * every attachment is re-targeted onto the body's armature (the rigs are identical by
    construction), so exports carry a single skeleton — what Unity/Unreal/Blender expect
  * skin tone:   body texture * (tone_linear / rig.skin.detailReference)   (same formula as the viewer)
  * eye color:   iris region of the eye texture recolored (rig.eyes UV layout)
  * tints:       texture x color for tintable assets
  * body shape:  uniform height scale + shoulder / leg bone offsets (rig.body)
  * morphs:      structural face sliders + expression preset ARKit weights
  * pose:        optional frozen animation frame (render) / every animation clip as glTF
                 animations (export)

Invoked as:  blender --background --factory-startup --python assemble_avatar.py -- <job.json>
The job file is written by AvatarForge.Infrastructure.Rendering.BlenderAvatarRenderer; every path
in it is server-resolved. Prints "ASSEMBLE_OK" on success; any failure raises (non-zero exit).
"""

import json
import math
import sys

import bpy
import mathutils

JUNK_OBJECT_NAMES = {"Icosphere"}

# (x, y, z) in glTF/three.js space (Y up, +Z toward the viewer) -> Blender (Z up)
def gl_to_blender(x, y, z):
    return mathutils.Vector((x, -z, y))


def read_config():
    argv = sys.argv[sys.argv.index("--") + 1:]
    if not argv:
        raise RuntimeError("No job config path passed after '--'")
    with open(argv[0], "r", encoding="utf-8") as f:
        return json.load(f)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_color):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new_objects = [o for o in bpy.data.objects if o not in before]
    for obj in list(new_objects):
        if obj.name.split(".")[0] in JUNK_OBJECT_NAMES:
            bpy.data.objects.remove(obj, do_unlink=True)
            new_objects.remove(obj)
    return new_objects


def principled_of(mat):
    if mat is None or not mat.use_nodes:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def multiply_base_color(obj, rgb_linear):
    """Texture x color, mirroring the viewer's material.color multiply (not a flat replace)."""
    rgba = (*rgb_linear, 1.0)
    for slot in obj.material_slots:
        mat = slot.material
        principled = principled_of(mat)
        if principled is None:
            continue
        base = principled.inputs.get("Base Color")
        if base.is_linked:
            source = base.links[0].from_socket
            mix = mat.node_tree.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            # ShaderNodeMix carries float/vector/color variants of "A", "B" and "Result" under the
            # same names — pick the RGBA ones explicitly (name lookup returns the hidden float socket).
            color_in = [sock for sock in mix.inputs if sock.type == "RGBA"]
            color_out = next(sock for sock in mix.outputs if sock.type == "RGBA")
            mix.inputs[0].default_value = 1.0
            mat.node_tree.links.new(source, color_in[0])
            color_in[1].default_value = rgba
            mat.node_tree.links.new(color_out, base)
        else:
            base.default_value = rgba


def recolor_iris(obj, eye_hex, rig):
    """Recolors only the iris ring of the eye texture, keeping its fibers/pupil via luminance."""
    import numpy as np

    centers = rig["eyes"]["irisCenters"]
    radius = rig["eyes"]["irisRadius"]
    target = np.array(hex_to_linear(eye_hex), dtype=np.float32)
    for slot in obj.material_slots:
        principled = principled_of(slot.material)
        if principled is None or not principled.inputs["Base Color"].is_linked:
            continue
        node = principled.inputs["Base Color"].links[0].from_node
        if node.type != "TEX_IMAGE" or node.image is None:
            continue
        src = node.image
        w, h = src.size
        pixels = np.empty(w * h * 4, dtype=np.float32)
        src.pixels.foreach_get(pixels)
        px = pixels.reshape(h, w, 4)
        # Blender image rows run bottom-up; glTF UV v runs top-down.
        ys, xs = np.mgrid[0:h, 0:w]
        u = (xs + 0.5) / w
        v = 1.0 - (ys + 0.5) / h
        dist = np.full((h, w), 9.0, dtype=np.float32)
        for cu, cv in centers:
            dist = np.minimum(dist, np.hypot(u - cu, v - cv))
        mask = np.clip((radius - dist) / (radius * 0.12), 0.0, 1.0)[..., None]
        lum = (0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2])[..., None]
        # The source iris averages ~0.12 linear luminance; scale so the chosen color reads true.
        recolored = np.clip(target * (lum / 0.12), 0.0, 1.0)
        px[..., :3] = px[..., :3] * (1 - mask) + recolored * mask
        out = bpy.data.images.new(f"{src.name}_iris", w, h, alpha=True)
        out.pixels.foreach_set(px.reshape(-1))
        out.pack()
        node.image = out


def apply_shape_keys(obj, shape_keys):
    if obj.type != "MESH" or not obj.data.shape_keys:
        return
    for name, value in shape_keys.items():
        key = obj.data.shape_keys.key_blocks.get(name)
        if key is not None:
            # Face sliders can run a target backwards (negative); Blender clamps to slider_min.
            key.slider_min = min(key.slider_min, value)
            key.value = value


def soften_specular(obj, level):
    """Hair cards: the default 0.5 specular turns dark hair into a gray sheen under studio lights."""
    for slot in obj.material_slots:
        principled = principled_of(slot.material)
        if principled is not None and principled.inputs.get("Specular IOR Level") is not None:
            principled.inputs["Specular IOR Level"].default_value = level


def facial_hair_material(obj):
    """Alpha = texture alpha x vertex alpha (coverage, and per shell: opacity + taper); base color x
    vertex RGB (per-shell shade). Same as the viewer's shell materials (Attachment.tsx growShells)."""
    for slot in obj.material_slots:
        mat = slot.material
        principled = principled_of(mat)
        if principled is None:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        alpha_in = principled.inputs["Alpha"]
        source = alpha_in.links[0].from_socket if alpha_in.is_linked else None
        vcol = nodes.new("ShaderNodeVertexColor")
        if obj.data.color_attributes:
            vcol.layer_name = obj.data.color_attributes[0].name
        mul = nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        links.new(vcol.outputs["Alpha"], mul.inputs[0])
        if source is not None:
            links.new(source, mul.inputs[1])
        else:
            mul.inputs[1].default_value = 1.0
        links.new(mul.outputs[0], alpha_in)
        base = principled.inputs.get("Base Color")
        if base.is_linked:
            shade = nodes.new("ShaderNodeMix")
            shade.data_type = "RGBA"
            shade.blend_type = "MULTIPLY"
            shade.inputs[0].default_value = 1.0
            color_in = [sock for sock in shade.inputs if sock.type == "RGBA"]
            color_out = next(sock for sock in shade.outputs if sock.type == "RGBA")
            links.new(base.links[0].from_socket, color_in[0])
            links.new(vcol.outputs["Color"], color_in[1])
            links.new(color_out, base)
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        else:
            mat.blend_method = "BLEND"


def grow_shells(obj):
    """Stack copies of a generated facial-hair surface (the recipe the generator stored in the mesh
    extras) — same technique and math as the web viewer: each shell is grown by offset x `_GROW`
    (the normal combed downward, its length the local thickness; glTF axes, converted here; v1
    assets: normal x `_THICKNESS`), and gets its own
    vertex colors: RGB = shade, A = coverage remapped by the shell's taper x opacity. Shells are real
    geometry with their own copy of the shape keys (offset applied to every key), so jaw, smile and
    face sliders move every layer."""
    import numpy as np

    recipe = obj.data.get("avatarforge") or obj.get("avatarforge")
    shells = [list(s) for s in (recipe.get("shells") if recipe else [])] if recipe else []
    if not shells:
        return [obj]
    mesh = obj.data
    n = len(mesh.vertices)

    grow = np.empty(n * 3, dtype=np.float32)
    attr = mesh.attributes.get("_GROW") or mesh.attributes.get("_grow")
    if attr is not None:
        attr.data.foreach_get("vector", grow)
        g = grow.reshape(n, 3)
        grow = np.stack([g[:, 0], -g[:, 2], g[:, 1]], axis=1)  # glTF Y-up -> Blender Z-up
    else:
        thickness = np.ones(n, dtype=np.float32)
        attr = mesh.attributes.get("_THICKNESS") or mesh.attributes.get("_thickness")
        if attr is not None:
            attr.data.foreach_get("value", thickness)
        mesh.vertices.foreach_get("normal", grow)
        grow = grow.reshape(n, 3)
        grow = grow / np.maximum(np.linalg.norm(grow, axis=1, keepdims=True), 1e-6) * thickness[:, None]

    color = mesh.color_attributes[0] if mesh.color_attributes else None
    coverage = None
    if color is not None:
        rgba = np.empty(len(color.data) * 4, dtype=np.float32)
        color.data.foreach_get("color", rgba)
        coverage = rgba.reshape(-1, 4)[:, 3].copy()

    result = []
    for index, shell_spec in enumerate(shells):
        offset, opacity = float(shell_spec[0]), float(shell_spec[1])
        taper = float(shell_spec[2]) if len(shell_spec) > 2 else 0.0
        shade = float(shell_spec[3]) if len(shell_spec) > 3 else 1.0
        shell = obj if index == len(shells) - 1 else obj.copy()
        if shell is not obj:
            shell.data = obj.data.copy()  # own geometry + own copy of the shape keys
            bpy.context.collection.objects.link(shell)
        data = shell.data
        delta = (grow * offset).astype(np.float32).reshape(-1)
        co = np.empty(n * 3, dtype=np.float32)
        data.vertices.foreach_get("co", co)
        data.vertices.foreach_set("co", co + delta)
        if data.shape_keys:
            for key in data.shape_keys.key_blocks:
                key.data.foreach_get("co", co)
                key.data.foreach_set("co", co + delta)
        if coverage is not None:
            alpha = opacity * np.clip((coverage - taper) / max(1e-3, 1.0 - taper), 0.0, 1.0)
            out = np.empty((len(alpha), 4), dtype=np.float32)
            out[:, 0:3] = shade
            out[:, 3] = alpha
            data.color_attributes[0].data.foreach_set("color", out.reshape(-1))
        data.update()
        result.append(shell)
    return result


def push_out(obj, distance):
    """Render-time stand-in for the viewer's polygonOffset: garments are form-fitted proxies that sit
    within millimetres of the skin, so without this the body pokes through in places. Evaluated
    after the Armature modifier; never baked into exports (export_apply=False)."""
    mod = obj.modifiers.new("AvatarForgePushOut", "DISPLACE")
    mod.direction = "NORMAL"
    mod.mid_level = 0.0
    mod.strength = distance


def retract_under(obj, hem_z, depth=0.012):
    """Where an outer layer covers this garment (above the top's hem), pull the surface back
    inside — same rule as the web viewer's garment shader: a waistband that genuinely sticks out
    through a shirt can't be hidden any other way, and that region is covered, so it's never seen."""
    group = obj.vertex_groups.new(name="af_retract")
    covered = [v.index for v in obj.data.vertices if (obj.matrix_world @ v.co).z > hem_z]
    if not covered:
        return
    group.add(covered, 1.0, "REPLACE")
    mod = obj.modifiers.new("AvatarForgeRetract", "DISPLACE")
    mod.direction = "NORMAL"
    mod.mid_level = 0.0
    mod.strength = -depth
    mod.vertex_group = group.name


def retarget_to(body_arm, objects):
    """Moves an attachment's meshes onto the body armature and deletes the attachment's own copy
    of the (identical) rig — one skeleton for the whole avatar."""
    own_arms = [o for o in objects if o.type == "ARMATURE"]
    for obj in objects:
        if obj.type != "MESH":
            continue
        for mod in obj.modifiers:
            if mod.type == "ARMATURE":
                mod.object = body_arm
        world = obj.matrix_world.copy()
        obj.parent = body_arm
        obj.matrix_world = world
    for arm in own_arms:
        data = arm.data
        bpy.data.objects.remove(arm, do_unlink=True)
        if data.users == 0:
            bpy.data.armatures.remove(data)


def body_bone_offsets(arm, cfg):
    """Shoulder / leg-length factors as pose-space translations (the viewer scales the same bones'
    rest positions). Bones are disconnected first; that doesn't move them, but lets them translate."""
    rig = cfg["rig"]["body"]
    factors = {}
    for name in rig["shoulderWidth"]["bones"]:
        factors[name] = cfg.get("shoulderFactor", 1.0)
    for name in rig["proportion"]["bones"]:
        factors[name] = cfg.get("legFactor", 1.0)
    if all(abs(f - 1.0) < 1e-6 for f in factors.values()):
        return {}

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name in factors:
        eb = arm.data.edit_bones.get(name)
        if eb is not None:
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    offsets = {}
    for name, f in factors.items():
        bone = arm.data.bones.get(name)
        if bone is None or bone.parent is None or abs(f - 1.0) < 1e-6:
            continue
        rel = bone.parent.matrix_local.inverted() @ bone.matrix_local
        delta_parent = rel.to_translation() * (f - 1.0)
        # pose location is expressed in the bone's own rest frame
        offsets[name] = rel.to_3x3().inverted() @ delta_parent
    return offsets


def leg_lift(arm, cfg):
    """Longer legs push the feet below the floor — lift the root by the extra leg length (as the viewer does)."""
    f = cfg.get("legFactor", 1.0)
    hip = arm.data.bones.get("upperleg01.L")
    foot = arm.data.bones.get("foot.L")
    if hip is None or foot is None or abs(f - 1.0) < 1e-6:
        return 0.0
    # armature space is Z-up after import
    return (f - 1.0) * (hip.head_local.z - foot.head_local.z)


def apply_pose(arm, bones, root_delta_gl, static_offsets, lift):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for name, offset in static_offsets.items():
        pb = arm.pose.bones.get(name)
        if pb is not None:
            pb.location = offset
    for name, q in (bones or {}).items():
        pb = arm.pose.bones.get(name)
        if pb is not None:
            pb.rotation_quaternion = (q[3], q[0], q[1], q[2])
    root = arm.pose.bones.get("root")
    if root is not None:
        delta = gl_to_blender(*(root_delta_gl or (0, 0, 0))) + mathutils.Vector((0, 0, lift))
        root.location = root.bone.matrix_local.to_3x3().inverted() @ delta


def build_actions(arm, clips, static_offsets, lift):
    """Every clip as its own Action on the body armature. None stays assigned, so the exported default
    (non-animated) pose is the configured avatar standing at rest; the exporter writes each action."""
    if arm.animation_data is None:
        arm.animation_data_create()
    root_bone = arm.data.bones.get("root")
    root_to_local = root_bone.matrix_local.to_3x3().inverted() if root_bone else None
    for clip in clips:
        action = bpy.data.actions.new(clip["id"])
        arm.animation_data.action = action
        fps = clip["fps"]
        frames = clip["frames"]
        for i in range(frames):
            frame = 1 + i * (bpy.context.scene.render.fps / fps)
            for name, values in clip["tracks"].items():
                pb = arm.pose.bones.get(name)
                if pb is None:
                    continue
                k = 0 if len(values) == 4 else i * 4
                pb.rotation_mode = "QUATERNION"
                pb.rotation_quaternion = (values[k + 3], values[k], values[k + 1], values[k + 2])
                pb.keyframe_insert("rotation_quaternion", frame=frame, group=name)
            if root_to_local is not None:
                root = clip["root"]
                d = (0, 0, 0) if not root else (root[0:3] if len(root) == 3 else root[i * 3:i * 3 + 3])
                pb = arm.pose.bones["root"]
                pb.location = root_to_local @ (gl_to_blender(*d) + mathutils.Vector((0, 0, lift)))
                pb.keyframe_insert("location", frame=frame, group="root")
        action.use_fake_user = True
        arm.animation_data.action = None
    # static body-shape offsets stay in the (non-animated) pose
    apply_pose(arm, None, None, static_offsets, lift)


def setup_camera_and_lights(cfg, height_scale):
    camera = cfg.get("camera", "full")
    presets = {
        # target (x,y,z) and camera position in glTF space, before height scaling
        "full": ((0, 0.9, 0), (0, 1.0, 4.3), 30),
        "front": ((0, 0.9, 0), (0, 0.95, 4.3), 30),
        "threeQuarter": ((0, 0.9, 0), (2.4, 1.1, 3.6), 30),
        "portrait": ((0, 1.52, 0.03), (0, 1.58, 1.35), 30),
    }
    target_gl, cam_gl, fov = presets.get(camera, presets["full"])
    s = height_scale
    target = bpy.data.objects.new("Target", None)
    target.location = gl_to_blender(target_gl[0], target_gl[1] * s, target_gl[2])
    bpy.context.collection.objects.link(target)

    cam_data = bpy.data.cameras.new("AvatarCamera")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(fov)
    cam_obj = bpy.data.objects.new("AvatarCamera", cam_data)
    cam_obj.location = gl_to_blender(cam_gl[0], cam_gl[1] * s, cam_gl[2])
    track = cam_obj.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    def add_light(name, loc_gl, energy, size=3.0, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, type="AREA")
        data.energy = energy
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = gl_to_blender(*loc_gl)
        c = obj.constraints.new("TRACK_TO")
        c.target = target
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"
        bpy.context.collection.objects.link(obj)

    # Same key / fill / rim idea as the web viewer's studio lighting.
    # Tuned so a mid-gray albedo reads mid-gray under the key light — product renders should show
    # the configured colors, not a washed-out version of them.
    add_light("KeyLight", (2.5, 3.2, 3.5), 240, color=(1.0, 0.97, 0.93))
    add_light("FillLight", (-3, 1.8, 2.5), 100, color=(0.88, 0.92, 1.0))
    add_light("RimLight", (0, 2.8, -3.2), 260)


def flatten_onto(path, hex_color):
    """Composites a transparent render onto an exact background color and rewrites it as an RGB PNG.
    Rendering the background itself would pass it through the view transform (Khronos PBR Neutral
    shifts very dark colors); the API promises the exact #RRGGBB the client asked for."""
    import struct
    import zlib

    import numpy as np

    image = bpy.data.images.load(path)
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)  # 8-bit PNG: stored (display) values in 0..1, rows bottom-up
    bpy.data.images.remove(image)
    px = px.reshape(h, w, 4)[::-1]
    bg = np.array([int(hex_color[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)
    alpha = px[..., 3:4]
    rgb = np.clip(px[..., :3] * alpha + bg * (1.0 - alpha), 0.0, 1.0)
    data = (rgb * 255.0 + 0.5).astype(np.uint8)
    raw = b"".join(b"\x00" + row.tobytes() for row in data)

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def setup_world(cfg):
    world = bpy.data.worlds.new("AvatarWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    color = cfg.get("background")
    if color:
        bg.inputs["Color"].default_value = (*hex_to_linear(color), 1.0)
        bg.inputs["Strength"].default_value = 1.0
    else:
        bg.inputs["Color"].default_value = (0.05, 0.055, 0.07, 1.0)
        bg.inputs["Strength"].default_value = 0.6


def main():
    cfg = read_config()
    rig = cfg["rig"]
    bpy.ops.wm.read_factory_settings(use_empty=True)

    body_objects = import_glb(cfg["bodyPath"])
    body_arm = next(o for o in body_objects if o.type == "ARMATURE")
    body_meshes = [o for o in body_objects if o.type == "MESH"]

    # Skin: the body GLB carries the tone-neutral detail texture; multiply by tone / reference.
    ref = rig["skin"]["detailReference"]
    # Unclamped, like the viewer: clamping flattens very fair tones toward white.
    tone = tuple(c / ref for c in hex_to_linear(cfg.get("skinTone", "#C68863")))
    for mesh in body_meshes:
        multiply_base_color(mesh, tone)

    all_meshes = list(body_meshes)
    garments = {}  # slot -> (layer, meshes)
    for attachment in cfg.get("attachments", []):
        objects = import_glb(attachment["path"])
        meshes = [o for o in objects if o.type == "MESH"]
        if attachment.get("slot") in ("top", "bottom", "hair", "head"):
            garments[attachment["slot"]] = (float(attachment.get("layer", 3)), meshes)
        if attachment.get("role") == "eyes":
            for m in meshes:
                recolor_iris(m, cfg.get("eyeColor", "#3B2415"), rig)
        elif attachment.get("color"):
            for m in meshes:
                multiply_base_color(m, hex_to_linear(attachment["color"]))
        if attachment.get("role") == "facialHair":
            for m in list(meshes):
                facial_hair_material(m)
                if cfg["operation"] == "render":
                    # Exports keep the single surface + its shell recipe in extras (modifiers aren't
                    # baked into glTF); renders grow the full volume.
                    grown = grow_shells(m)
                    objects.extend(o for o in grown if o not in objects)
                    meshes.extend(o for o in grown if o not in meshes)
        asset_path = attachment["path"].replace("\\", "/")
        if any(part in asset_path for part in ("/hair_", "/beard_", "/mustache_", "/body_eyebrows")):
            for m in meshes:
                soften_specular(m, 0.15)
        if attachment.get("role") == "clothing" and cfg["operation"] == "render":
            # Outer garments sit further out (rig-spec garmentLayers): shirt over trousers, hair over collar.
            distance = 0.0012 + 0.0008 * float(attachment.get("layer", 3))
            for m in meshes:
                push_out(m, distance)
        retarget_to(body_arm, objects)
        all_meshes.extend(meshes)

    for mesh in all_meshes:
        apply_shape_keys(mesh, cfg.get("shapeKeys", {}))

    # Layering (same rules as the web viewer): an outer piece's lowest edge decides where the piece
    # it covers tucks in underneath — trousers under a shirt's hem (unless the top is the tucked-in
    # one), hair under a hat's rim.
    def lowest(meshes):
        return min((m.matrix_world @ v.co).z for m in meshes for v in m.data.vertices)

    if cfg["operation"] == "render":
        if "top" in garments and "bottom" in garments and garments["top"][0] > garments["bottom"][0]:
            hem = lowest(garments["top"][1])
            for m in garments["bottom"][1]:
                retract_under(m, hem + 0.015)
        if "head" in garments and "hair" in garments:
            rim = lowest(garments["head"][1])
            for m in garments["hair"][1]:
                retract_under(m, rim + 0.02, depth=0.025)

    offsets = body_bone_offsets(body_arm, cfg)
    lift = leg_lift(body_arm, cfg)
    pose = cfg.get("pose") or {}
    apply_pose(body_arm, pose.get("bones"), pose.get("root"), offsets, lift)

    height_scale = cfg.get("heightScale", 1.0)
    body_arm.scale = (height_scale, height_scale, height_scale)

    operation = cfg["operation"]
    if operation == "export":
        clips = cfg.get("animations") or []
        if clips:
            bpy.context.scene.render.fps = clips[0]["fps"]
            build_actions(body_arm, clips, offsets, lift)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in [body_arm, *all_meshes]:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = body_arm
        bpy.ops.export_scene.gltf(
            filepath=cfg["outputPath"],
            export_format="GLB",
            use_selection=True,
            export_apply=False,
            export_yup=True,
            export_morph=True,
            export_skins=True,
            export_animations=bool(clips),
            export_animation_mode="ACTIONS",
            # Only the channels the clips actually key (bone rotations + root), not all 163 bones x TRS.
            export_force_sampling=False,
            # Node TRS = current pose, so the body-shape bone offsets become part of the exported rest.
            export_rest_position_armature=False,
            export_extras=True,
            export_image_format="WEBP",
            export_image_quality=85,
        )
    elif operation == "render":
        setup_world(cfg)
        setup_camera_and_lights(cfg, height_scale)
        scene = bpy.context.scene
        scene.render.resolution_x = cfg["width"]
        scene.render.resolution_y = cfg["height"]
        # A solid background is composited afterwards (flatten_onto), so the film is always transparent.
        scene.render.film_transparent = True
        # Same tone mapping as the web viewer (three.js NeutralToneMapping): colors stay true.
        try:
            scene.view_settings.view_transform = "Khronos PBR Neutral"
        except TypeError:
            scene.view_settings.view_transform = "Standard"
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.filepath = cfg["outputPath"]
        bpy.ops.render.render(write_still=True)
        if cfg.get("background") and not cfg.get("transparent", True):
            flatten_onto(cfg["outputPath"], cfg["background"])
    else:
        raise RuntimeError(f"Unknown operation: {operation}")

    print("ASSEMBLE_OK")


main()
