namespace AvatarForge.Infrastructure.Rendering;

public class BlenderOptions
{
    public string BlenderExecutablePath { get; set; } = string.Empty;
    public string AssembleScriptPath { get; set; } = string.Empty;
    /// <summary>Root of the Blender-importable (non-meshopt) GLB set — see docs/export-pipeline.md for why this is a separate copy from public/models/.</summary>
    public string ServerAssetsRoot { get; set; } = string.Empty;
    public int TimeoutSeconds { get; set; } = 90;
    public int MaxRenderDimension { get; set; } = 2048;
    public int MinRenderDimension { get; set; } = 64;
    /// <summary>Blender processes allowed to run at once; further requests wait their turn (each process is CPU/GPU and memory heavy).</summary>
    public int MaxConcurrentJobs { get; set; } = 2;
}
