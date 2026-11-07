using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using AvatarForge.Domain.Configuration;

namespace AvatarForge.Application.Catalog;

public sealed class CatalogCategory
{
    public string Id { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public string Kind { get; init; } = string.Empty;
    public string? Slot { get; init; }
    public List<string>? Slots { get; init; }
    public bool AllowNone { get; init; } = true;
    public string? Icon { get; init; }
}

public sealed class CatalogAsset
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Category { get; init; } = string.Empty;
    public string Slot { get; init; } = string.Empty;
    public string? Model { get; init; }
    public string? Thumbnail { get; init; }
    public List<string> CompatibleWith { get; init; } = [];
    public List<string> IncompatibleWith { get; init; } = [];
    public List<string> Tags { get; init; } = [];
    public List<string> Styles { get; init; } = [];
    public List<string>? Colors { get; init; }
    public string? Palette { get; init; }
    public bool AlwaysOn { get; init; }
    /// <summary>Garment stacking override (rig-spec.json garmentLayers).</summary>
    public double? Layer { get; init; }
    public int? AssetVersion { get; init; }
    public string? License { get; init; }
    public string? Author { get; init; }
    public string? Source { get; init; }
}

public sealed class CatalogBodyType
{
    public string Id { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public double ShoulderWidth { get; init; }
    public double Proportion { get; init; }
}

public sealed class ExpressionDefinition
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public Dictionary<string, double> Morphs { get; init; } = [];
}

public sealed class AvatarPresetDefinition
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public AvatarConfigurationDto Configuration { get; init; } = new();
}

/// <summary>One sampled animation clip (see tools/asset-pipeline/build_animation_clips.mjs for the format).</summary>
public sealed class AnimationClipDefinition
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Icon { get; init; }
    public double Duration { get; init; }
    public bool Loop { get; init; } = true;
    public double FadeIn { get; init; } = 0.35;
    public string? Expression { get; init; }
    public int Frames { get; init; }
    /// <summary>Bone name (Blender/glTF naming, e.g. "upperarm01.L") → flat [x,y,z,w,...] quaternion deltas per frame, applied on top of the bone's rest rotation.</summary>
    public Dictionary<string, List<double>> Tracks { get; init; } = [];
    /// <summary>Flat [x,y,z,...] root translation deltas per frame, in armature (model) space, meters.</summary>
    public List<double> Root { get; init; } = [];
}

public sealed class AnimationLibrary
{
    public int Version { get; init; }
    public int Fps { get; init; }
    public List<AnimationClipDefinition> Clips { get; init; } = [];
}

/// <summary>
/// Read-only view over shared/*.json (embedded into this assembly at build time — see the csproj).
/// The web creator imports the exact same files, so catalog ids, palettes, presets, expressions and
/// animation clips can never drift between the API and the reference web client.
/// </summary>
public static class SharedCatalog
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { ReadCommentHandling = JsonCommentHandling.Skip };

    private static readonly Lazy<JsonObject> CatalogRoot = new(() => ReadNode("asset-catalog.json"));

    private static readonly Lazy<List<CatalogAsset>> AssetsLazy = new(() =>
        CatalogRoot.Value["assets"].Deserialize<List<CatalogAsset>>(JsonOptions) ?? []);

    private static readonly Lazy<List<CatalogCategory>> CategoriesLazy = new(() =>
        CatalogRoot.Value["categories"].Deserialize<List<CatalogCategory>>(JsonOptions) ?? []);

    private static readonly Lazy<Dictionary<string, List<string>>> PalettesLazy = new(() =>
        CatalogRoot.Value["palettes"].Deserialize<Dictionary<string, List<string>>>(JsonOptions) ?? []);

    private static readonly Lazy<List<CatalogBodyType>> BodyTypesLazy = new(() =>
        CatalogRoot.Value["bodyTypes"].Deserialize<List<CatalogBodyType>>(JsonOptions) ?? []);

    private static readonly Lazy<List<ExpressionDefinition>> ExpressionsLazy = new(() =>
        ReadNode("expressions.json")["expressions"].Deserialize<List<ExpressionDefinition>>(JsonOptions) ?? []);

    private static readonly Lazy<List<AvatarPresetDefinition>> PresetsLazy = new(() =>
        ReadNode("avatar-presets.json")["presets"].Deserialize<List<AvatarPresetDefinition>>(JsonOptions) ?? []);

    private static readonly Lazy<AnimationLibrary> AnimationsLazy = new(() =>
        ReadNode("animation-clips.json").Deserialize<AnimationLibrary>(JsonOptions) ?? new AnimationLibrary());

    private static readonly Lazy<JsonObject> RigSpecLazy = new(() => ReadNode("rig-spec.json"));

    public static IReadOnlyList<CatalogAsset> Assets => AssetsLazy.Value;
    public static IReadOnlyList<CatalogCategory> Categories => CategoriesLazy.Value;
    public static IReadOnlyDictionary<string, List<string>> Palettes => PalettesLazy.Value;
    public static IReadOnlyList<CatalogBodyType> BodyTypes => BodyTypesLazy.Value;
    public static IReadOnlyList<ExpressionDefinition> Expressions => ExpressionsLazy.Value;
    public static IReadOnlyList<AvatarPresetDefinition> Presets => PresetsLazy.Value;
    public static AnimationLibrary Animations => AnimationsLazy.Value;
    public static JsonObject RigSpec => RigSpecLazy.Value;

    public static CatalogAsset? FindAsset(string? id) =>
        id is null ? null : Assets.FirstOrDefault(a => a.Id == id);

    public static ExpressionDefinition? FindExpression(string? id) =>
        Expressions.FirstOrDefault(e => e.Id == (id ?? "neutral"));

    public static AnimationClipDefinition? FindAnimation(string? id) =>
        Animations.Clips.FirstOrDefault(c => c.Id == id);

    /// <summary>The swatches an asset offers: its own list, else its named palette.</summary>
    public static List<string>? ResolveColors(CatalogAsset asset) =>
        asset.Colors is { Count: > 0 } ? asset.Colors
        : asset.Palette is not null && Palettes.TryGetValue(asset.Palette, out var palette) ? palette
        : null;

    private static JsonObject ReadNode(string fileName)
    {
        var resourceName = $"AvatarForge.Shared.{fileName}";
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded shared resource '{resourceName}' is missing — is shared/{fileName} present at build time?");
        return JsonNode.Parse(stream, documentOptions: new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip })?.AsObject()
            ?? throw new InvalidOperationException($"shared/{fileName} is not a JSON object.");
    }
}
