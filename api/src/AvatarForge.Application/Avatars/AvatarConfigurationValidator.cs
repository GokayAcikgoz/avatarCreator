using System.Text.RegularExpressions;
using AvatarForge.Application.Catalog;
using AvatarForge.Application.Common;
using AvatarForge.Domain.Configuration;

namespace AvatarForge.Application.Avatars;

/// <summary>
/// Server-side mirror of the web creator's zod schema (src/features/avatar/config/avatarConfig.ts)
/// plus catalog-aware rules the client can't be trusted to enforce: every referenced asset must
/// exist in the shared catalog AND sit in the slot it's used for (no shoes in the hair slot), at
/// most one accessory per attachment slot, expression ids must be real, numbers in range, colors
/// valid hex. All violations are collected and returned together in `details.errors`, so an API
/// consumer can fix a payload in one round-trip instead of one error at a time.
/// </summary>
public static partial class AvatarConfigurationValidator
{
    public const int MaxAccessories = 8;
    public const int MaxMorphs = 64;

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    public static void Validate(AvatarConfigurationDto? configuration)
    {
        var errors = new List<string>();
        if (configuration is null)
        {
            throw new ApiException(ErrorCodes.InvalidConfiguration, "configuration is required.", statusCode: 400);
        }

        if (configuration.Version != 1)
        {
            throw new ApiException(
                ErrorCodes.InvalidConfiguration,
                $"Unsupported configuration version '{configuration.Version}'. Only version 1 is currently supported.",
                statusCode: 400
            );
        }

        if (configuration.Body is null || configuration.Face is null || configuration.Hair is null
            || configuration.FacialHair is null || configuration.Clothing is null)
        {
            throw new ApiException(ErrorCodes.InvalidConfiguration, "configuration must include body, face, hair, facialHair and clothing.", statusCode: 400);
        }

        Unit(errors, "body.height", configuration.Body.Height);
        Unit(errors, "body.shoulderWidth", configuration.Body.ShoulderWidth);
        Unit(errors, "body.proportion", configuration.Body.Proportion);
        ShortText(errors, "body.type", configuration.Body.Type);

        var face = configuration.Face;
        Color(errors, "face.skinTone", face.SkinTone);
        Color(errors, "face.eyeColor", face.EyeColor);
        ShortText(errors, "face.shape", face.Shape);
        ShortText(errors, "face.eyeShape", face.EyeShape);
        ShortText(errors, "face.eyebrows", face.Eyebrows);
        ShortText(errors, "face.nose", face.Nose);
        ShortText(errors, "face.mouth", face.Mouth);
        ShortText(errors, "face.earShape", face.EarShape);
        if (SharedCatalog.FindExpression(face.Expression) is null)
        {
            errors.Add($"face.expression '{face.Expression}' is not a known expression ({string.Join(", ", SharedCatalog.Expressions.Select(e => e.Id))}).");
        }
        face.Morphs ??= [];
        if (face.Morphs.Count > MaxMorphs) errors.Add($"face.morphs may contain at most {MaxMorphs} entries.");
        foreach (var (name, value) in face.Morphs)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Length > 64) errors.Add("face.morphs keys must be 1-64 characters.");
            if (double.IsNaN(value) || value < -1 || value > 1) errors.Add($"face.morphs['{name}'] must be between -1 and 1.");
        }

        Color(errors, "hair.color", configuration.Hair.Color);
        Slot(errors, "hair.style", configuration.Hair.Style, "hair", required: false);

        Color(errors, "facialHair.color", configuration.FacialHair.Color);
        Slot(errors, "facialHair.beardStyle", configuration.FacialHair.BeardStyle, "beard", required: false);
        Slot(errors, "facialHair.mustacheStyle", configuration.FacialHair.MustacheStyle, "mustache", required: false);

        var clothing = configuration.Clothing;
        Color(errors, "clothing.topColor", clothing.TopColor);
        Color(errors, "clothing.bottomColor", clothing.BottomColor);
        Color(errors, "clothing.shoesColor", clothing.ShoesColor);
        Slot(errors, "clothing.top", clothing.Top, "top", required: false);
        Slot(errors, "clothing.bottom", clothing.Bottom, "bottom", required: false);
        Slot(errors, "clothing.shoes", clothing.Shoes, "shoes", required: false);

        configuration.Accessories ??= [];
        configuration.AccessoryColors ??= [];
        if (configuration.Accessories.Count > MaxAccessories) errors.Add($"accessories may contain at most {MaxAccessories} items.");
        var accessorySlots = SharedCatalog.Categories.Where(c => c.Kind == "accessories").SelectMany(c => c.Slots ?? []).ToHashSet();
        var usedSlots = new Dictionary<string, string>();
        foreach (var id in configuration.Accessories)
        {
            var asset = SharedCatalog.FindAsset(id);
            if (asset is null)
            {
                errors.Add($"accessories: unknown asset '{id}'.");
                continue;
            }
            if (!accessorySlots.Contains(asset.Slot))
            {
                errors.Add($"accessories: '{id}' is a '{asset.Slot}' asset, not an accessory.");
                continue;
            }
            if (usedSlots.TryGetValue(asset.Slot, out var other))
            {
                errors.Add($"accessories: '{id}' and '{other}' both occupy the '{asset.Slot}' slot — only one is allowed.");
                continue;
            }
            usedSlots[asset.Slot] = id;
        }
        foreach (var (id, color) in configuration.AccessoryColors)
        {
            Color(errors, $"accessoryColors['{id}']", color);
        }

        if (errors.Count > 0)
        {
            throw new ApiException(
                ErrorCodes.InvalidConfiguration,
                errors.Count == 1 ? errors[0] : $"The configuration has {errors.Count} problems.",
                statusCode: 400,
                details: new { errors }
            );
        }
    }

    /// <summary>Every asset id a configuration references (for the pairwise compatibility check).</summary>
    public static List<string?> SelectedAssetIds(AvatarConfigurationDto configuration)
    {
        var selected = new List<string?>
        {
            configuration.Hair.Style,
            configuration.FacialHair.BeardStyle,
            configuration.FacialHair.MustacheStyle,
            configuration.Clothing.Top,
            configuration.Clothing.Bottom,
            configuration.Clothing.Shoes,
        };
        selected.AddRange(configuration.Accessories);
        return selected;
    }

    private static void Unit(List<string> errors, string field, double value)
    {
        if (double.IsNaN(value) || value < 0 || value > 1) errors.Add($"{field} must be between 0 and 1.");
    }

    private static void Color(List<string> errors, string field, string? value)
    {
        if (value is null || !HexColor().IsMatch(value)) errors.Add($"{field} must be a #RRGGBB hex color.");
    }

    private static void ShortText(List<string> errors, string field, string? value)
    {
        if (value is null || value.Length > 32) errors.Add($"{field} must be a string of at most 32 characters.");
    }

    private static void Slot(List<string> errors, string field, string? assetId, string expectedSlot, bool required)
    {
        if (string.IsNullOrEmpty(assetId))
        {
            if (required) errors.Add($"{field} is required.");
            return;
        }
        var asset = SharedCatalog.FindAsset(assetId);
        if (asset is null)
        {
            errors.Add($"{field}: unknown asset '{assetId}'.");
        }
        else if (asset.Slot != expectedSlot)
        {
            errors.Add($"{field}: '{assetId}' is a '{asset.Slot}' asset and can't be used as {expectedSlot}.");
        }
    }
}
