using AvatarForge.Domain.Configuration;

namespace AvatarForge.Application.Rendering;

/// <summary>
/// Server-side rendering/export of an AvatarConfiguration (CLAUDE.md §14/§15/§28). Implemented by
/// BlenderAvatarRenderer, which drives tools/blender-pipeline/assemble_avatar.py headlessly.
/// Synchronous today; the result type is already shaped for a queued job model.
/// </summary>
public interface IAvatarRenderer
{
    Task<RenderResult> RenderPngAsync(AvatarConfigurationDto configuration, RenderOptions options, CancellationToken ct = default);
    Task<RenderResult> ExportGlbAsync(AvatarConfigurationDto configuration, ExportOptions options, CancellationToken ct = default);
}

public class RenderOptions
{
    public int Width { get; set; } = 1024;
    public int Height { get; set; } = 1024;
    /// <summary>"transparent" or a #RRGGBB color.</summary>
    public string Background { get; set; } = "transparent";
    /// <summary>One of <see cref="RenderCameras.All"/>.</summary>
    public string Camera { get; set; } = RenderCameras.Full;
    /// <summary>Animation clip id (shared/animation-clips.json) to pose the avatar with; null = rest stance.</summary>
    public string? Animation { get; set; }
    /// <summary>Seconds into the animation clip.</summary>
    public double Time { get; set; }
}

public class ExportOptions
{
    /// <summary>Embed every animation clip as a glTF animation (usable directly in Unity/Unreal/Blender).</summary>
    public bool IncludeAnimations { get; set; } = true;
}

public static class RenderCameras
{
    public const string Full = "full";
    public const string Front = "front";
    public const string Portrait = "portrait";
    public const string ThreeQuarter = "threeQuarter";
    public static readonly string[] All = [Full, Front, Portrait, ThreeQuarter];
}

public class RenderResult
{
    public required string Url { get; set; }
    public required string Format { get; set; }
}
