using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using AvatarForge.Application.Animation;
using AvatarForge.Application.Catalog;
using AvatarForge.Application.Common;
using AvatarForge.Application.Rendering;
using AvatarForge.Application.Storage;
using AvatarForge.Domain.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AvatarForge.Infrastructure.Rendering;

/// <summary>
/// Drives tools/blender-pipeline/assemble_avatar.py headlessly: AvatarConfiguration -&gt;
/// AssetResolver -&gt; a fresh per-request temp dir with a JSON job file -&gt; `blender --background`
/// -&gt; GLB/PNG -&gt; IObjectStorage -&gt; a download URL. Synchronous (CLAUDE.md allows it for the
/// MVP); a process-wide semaphore caps concurrent Blender processes so a burst of render calls
/// queues instead of exhausting the host. Moving to a background queue only touches this class.
/// </summary>
public partial class BlenderAvatarRenderer(
    IAssetResolver assetResolver,
    IObjectStorage storage,
    IOptions<BlenderOptions> options,
    ILogger<BlenderAvatarRenderer> logger
) : IAvatarRenderer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static SemaphoreSlim? _gate;
    private static readonly object GateLock = new();

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    public async Task<RenderResult> RenderPngAsync(AvatarConfigurationDto configuration, RenderOptions renderOptions, CancellationToken ct = default)
    {
        var opts = options.Value;
        var width = renderOptions.Width;
        var height = renderOptions.Height;
        if (width < opts.MinRenderDimension || width > opts.MaxRenderDimension || height < opts.MinRenderDimension || height > opts.MaxRenderDimension)
        {
            throw new ApiException(
                ErrorCodes.ValidationFailed,
                $"width/height must be between {opts.MinRenderDimension} and {opts.MaxRenderDimension} (got {width}x{height}).",
                statusCode: 400
            );
        }
        if (!RenderCameras.All.Contains(renderOptions.Camera))
        {
            throw new ApiException(ErrorCodes.ValidationFailed, $"camera must be one of: {string.Join(", ", RenderCameras.All)}.", statusCode: 400);
        }
        var background = renderOptions.Background?.Trim() ?? "transparent";
        if (background != "transparent" && !HexColor().IsMatch(background))
        {
            throw new ApiException(ErrorCodes.ValidationFailed, "background must be \"transparent\" or a #RRGGBB color.", statusCode: 400);
        }
        SampledPose? pose = null;
        if (!string.IsNullOrEmpty(renderOptions.Animation))
        {
            var clip = SharedCatalog.FindAnimation(renderOptions.Animation)
                ?? throw new ApiException(ErrorCodes.ValidationFailed, $"Unknown animation '{renderOptions.Animation}'. See GET /api/v1/animations.", statusCode: 400);
            if (double.IsNaN(renderOptions.Time) || renderOptions.Time < 0 || renderOptions.Time > 3600)
            {
                throw new ApiException(ErrorCodes.ValidationFailed, "time must be between 0 and 3600 seconds.", statusCode: 400);
            }
            pose = AnimationSampler.Sample(clip, renderOptions.Time);
            if (clip.Expression is not null && configuration.Face.Expression == "neutral")
            {
                // Same coupling as the web viewer: an animation with a signature expression (laugh, wave...) shows it.
                configuration.Face.Expression = clip.Expression;
            }
        }

        var resolved = await assetResolver.ResolveAsync(configuration, ct);
        return await RunJobAsync(resolved, "render", "output.png", "image/png", "renders", job =>
        {
            job["width"] = width;
            job["height"] = height;
            job["transparent"] = background == "transparent";
            job["background"] = background == "transparent" ? null : background;
            job["camera"] = renderOptions.Camera;
            job["pose"] = pose is null ? null : new Dictionary<string, object?> { ["bones"] = pose.Bones, ["root"] = pose.Root };
        }, ct);
    }

    public async Task<RenderResult> ExportGlbAsync(AvatarConfigurationDto configuration, ExportOptions exportOptions, CancellationToken ct = default)
    {
        var resolved = await assetResolver.ResolveAsync(configuration, ct);
        return await RunJobAsync(resolved, "export", "output.glb", "model/gltf-binary", "exports", job =>
        {
            job["animations"] = exportOptions.IncludeAnimations
                ? SharedCatalog.Animations.Clips.Select(c => new Dictionary<string, object?>
                {
                    ["id"] = c.Id,
                    ["duration"] = c.Duration,
                    ["frames"] = c.Frames,
                    ["fps"] = SharedCatalog.Animations.Fps,
                    ["tracks"] = c.Tracks,
                    ["root"] = c.Root,
                }).ToList()
                : null;
        }, ct);
    }

    private async Task<RenderResult> RunJobAsync(
        ResolvedAvatarAssets resolved,
        string operation,
        string outputFileName,
        string contentType,
        string storageFolder,
        Action<Dictionary<string, object?>> configureJob,
        CancellationToken ct
    )
    {
        var gate = Gate(options.Value.MaxConcurrentJobs);
        await gate.WaitAsync(ct);

        var workDir = Path.Combine(Path.GetTempPath(), "avatarforge-render", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDir);

        try
        {
            var outputPath = Path.Combine(workDir, outputFileName);
            var job = new Dictionary<string, object?>
            {
                ["operation"] = operation,
                ["bodyPath"] = resolved.BodyPath,
                ["skinTexturePath"] = resolved.SkinTexturePath,
                ["skinTone"] = resolved.SkinTone,
                ["eyeColor"] = resolved.EyeColor,
                ["heightScale"] = resolved.HeightScale,
                ["shoulderFactor"] = resolved.ShoulderFactor,
                ["legFactor"] = resolved.LegFactor,
                ["rig"] = SharedCatalog.RigSpec,
                ["attachments"] = resolved.Attachments.Select(a => new Dictionary<string, object?> { ["path"] = a.Path, ["color"] = a.ColorHex, ["role"] = a.Role, ["layer"] = a.Layer, ["slot"] = a.Slot }).ToList(),
                ["shapeKeys"] = resolved.ShapeKeys,
                ["outputPath"] = outputPath,
            };
            configureJob(job);

            var configPath = Path.Combine(workDir, "job.json");
            await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(job, JsonOptions), ct);

            await RunBlenderAsync(configPath, ct);

            if (!File.Exists(outputPath))
            {
                throw new ApiException("RENDER_FAILED", "Blender exited successfully but produced no output file.", statusCode: 500);
            }

            await using var fileStream = File.OpenRead(outputPath);
            var url = await storage.SaveAsync($"{storageFolder}/{Guid.NewGuid():N}{Path.GetExtension(outputFileName)}", fileStream, contentType, ct);
            return new RenderResult { Url = url, Format = Path.GetExtension(outputFileName).TrimStart('.') };
        }
        finally
        {
            gate.Release();
            await DeleteWorkDirAsync(workDir);
        }
    }

    /// <summary>A just-killed Blender can hold file handles for a moment on Windows — retry briefly instead of leaking the directory.</summary>
    private async Task DeleteWorkDirAsync(string workDir)
    {
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                if (Directory.Exists(workDir)) Directory.Delete(workDir, recursive: true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                if (attempt == 5)
                {
                    logger.LogWarning(ex, "Failed to clean up render temp dir {WorkDir}", workDir);
                    return;
                }
                await Task.Delay(200 * attempt);
            }
        }
    }

    private static SemaphoreSlim Gate(int maxConcurrent)
    {
        if (_gate is not null) return _gate;
        lock (GateLock)
        {
            return _gate ??= new SemaphoreSlim(Math.Max(1, maxConcurrent));
        }
    }

    private async Task RunBlenderAsync(string configPath, CancellationToken ct)
    {
        var opts = options.Value;
        var psi = new ProcessStartInfo
        {
            FileName = opts.BlenderExecutablePath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        // ArgumentList, not a concatenated string — no shell is involved, so nothing here can be
        // interpreted as a shell metacharacter regardless of what a path contains.
        psi.ArgumentList.Add("--background");
        psi.ArgumentList.Add("--factory-startup");
        psi.ArgumentList.Add("--python");
        psi.ArgumentList.Add(opts.AssembleScriptPath);
        psi.ArgumentList.Add("--");
        psi.ArgumentList.Add(configPath);

        using var process = new Process { StartInfo = psi };
        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Could not start Blender at {Path}", opts.BlenderExecutablePath);
            throw new ApiException("RENDERER_UNAVAILABLE", "The render service is not available on this server.", statusCode: 503);
        }

        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = process.StandardError.ReadToEndAsync(ct);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(opts.TimeoutSeconds));

        try
        {
            await process.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            TryKill(process);
            throw new ApiException("RENDER_TIMEOUT", $"Avatar rendering did not complete within {opts.TimeoutSeconds}s.", statusCode: 504);
        }

        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        if (process.ExitCode != 0 || !stdout.Contains("ASSEMBLE_OK"))
        {
            logger.LogError("Blender assembly failed (exit {ExitCode}). stdout tail: {Stdout} stderr: {Stderr}", process.ExitCode, Tail(stdout), Tail(stderr));
            throw new ApiException("RENDER_FAILED", "Avatar rendering failed.", statusCode: 500, details: new { exitCode = process.ExitCode });
        }
    }

    private static string Tail(string text) => text.Length <= 4000 ? text : text[^4000..];

    private void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(5000);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to kill timed-out Blender process {Pid}", process.Id);
        }
    }
}
