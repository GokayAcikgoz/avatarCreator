namespace AvatarForge.Application.Catalog;

/// <summary>C# twin of src/features/avatar/config/rigSpec.ts — slider (0..1) to body factor, 0.5 always meaning "as authored".</summary>
public static class RigMath
{
    public static double SliderToFactor(double value, double min, double max)
    {
        var v = Math.Clamp(value, 0, 1);
        return v < 0.5 ? min + (1 - min) * (v / 0.5) : 1 + (max - 1) * ((v - 0.5) / 0.5);
    }

    public static double HeightScale(double value) =>
        SliderToFactor(value, Number("body", "height", "minScale"), Number("body", "height", "maxScale"));

    public static double ShoulderFactor(double value) =>
        SliderToFactor(value, Number("body", "shoulderWidth", "minFactor"), Number("body", "shoulderWidth", "maxFactor"));

    public static double LegFactor(double value) =>
        SliderToFactor(value, Number("body", "proportion", "minFactor"), Number("body", "proportion", "maxFactor"));

    /// <summary>Stacking order of a garment (higher = outer): the asset's own override, else its slot default.</summary>
    public static double GarmentLayer(CatalogAsset? asset)
    {
        if (asset?.Layer is { } layer) return layer;
        var node = SharedCatalog.RigSpec["garmentLayers"]?[asset?.Slot ?? ""];
        return node is System.Text.Json.Nodes.JsonValue value && value.TryGetValue<double>(out var d) ? d : 3;
    }

    private static double Number(params string[] path)
    {
        System.Text.Json.Nodes.JsonNode? node = SharedCatalog.RigSpec;
        foreach (var key in path) node = node?[key];
        return node?.GetValue<double>() ?? throw new InvalidOperationException($"rig-spec.json is missing {string.Join('.', path)}");
    }
}
