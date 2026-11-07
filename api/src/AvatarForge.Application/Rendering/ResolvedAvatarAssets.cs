using AvatarForge.Domain.Configuration;

namespace AvatarForge.Application.Rendering;

/// <summary>Everything the Blender assembly script needs, resolved from an AvatarConfiguration — only server-known file paths, never caller-supplied ones.</summary>
public class ResolvedAvatarAssets
{
    public required string BodyPath { get; set; }
    public required string SkinTexturePath { get; set; }
    public List<ResolvedAttachment> Attachments { get; set; } = [];

    /// <summary>Structural face-morph values merged with the resolved expression preset's ARKit weights — the same set the web viewer drives.</summary>
    public Dictionary<string, double> ShapeKeys { get; set; } = [];

    public string SkinTone { get; set; } = "#C68863";
    public string EyeColor { get; set; } = "#3B2415";

    /// <summary>Uniform avatar scale from body.height, and bone-offset factors from body.shoulderWidth/proportion (see shared/rig-spec.json).</summary>
    public double HeightScale { get; set; } = 1;
    public double ShoulderFactor { get; set; } = 1;
    public double LegFactor { get; set; } = 1;
}

public class ResolvedAttachment
{
    public required string Path { get; set; }
    public string? ColorHex { get; set; }
    /// <summary>"eyes" gets its iris recolored; "clothing" is pushed off the skin at render time; "facialHair" grows its fur shells; "generic" is a plain texture tint.</summary>
    public string Role { get; set; } = "generic";
    /// <summary>Garment stacking order — outer layers are pushed further off the skin so they win over what they cover.</summary>
    public double Layer { get; set; } = 3;
    /// <summary>Catalog slot ("top", "bottom"...) — the top's hem decides where the bottom tucks in underneath it.</summary>
    public string? Slot { get; set; }
}

public interface IAssetResolver
{
    Task<ResolvedAvatarAssets> ResolveAsync(AvatarConfigurationDto configuration, CancellationToken ct = default);
}
