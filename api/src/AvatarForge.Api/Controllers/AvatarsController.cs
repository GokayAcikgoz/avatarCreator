using System.Security.Claims;
using AvatarForge.Api.Authentication;
using AvatarForge.Api.Middleware;
using AvatarForge.Application.Avatars;
using AvatarForge.Application.Common;
using AvatarForge.Application.Projects;
using AvatarForge.Application.Rendering;
using AvatarForge.Application.Storage;
using AvatarForge.Domain.Configuration;
using AvatarForge.Domain.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AvatarForge.Api.Controllers;

public class RenderAvatarRequest
{
    public string Format { get; set; } = "png";
    public int Width { get; set; } = 1024;
    public int Height { get; set; } = 1024;
    /// <summary>Legacy flag kept for existing clients; <see cref="Background"/> wins when both are sent.</summary>
    public bool? Transparent { get; set; }
    /// <summary>"transparent" or #RRGGBB.</summary>
    public string? Background { get; set; }
    /// <summary>full | front | portrait | threeQuarter</summary>
    public string Camera { get; set; } = RenderCameras.Full;
    /// <summary>Animation clip id (GET /api/v1/animations) to pose the avatar with.</summary>
    public string? Animation { get; set; }
    /// <summary>Seconds into the animation.</summary>
    public double Time { get; set; }
}

/// <summary>CLAUDE.md §28's stateless shape: the avatar id travels in the body.</summary>
public class RenderByIdRequest : RenderAvatarRequest
{
    public Guid AvatarId { get; set; }
}

public class ExportAvatarRequest
{
    public string Format { get; set; } = "glb";
    public bool IncludeAnimations { get; set; } = true;
}

/// <summary>
/// Avatars can be created and managed two ways, never mixed within one request:
/// <list type="bullet">
/// <item>X-API-Key — a developer's app; the avatar belongs to that key's Project.</item>
/// <item>Cookie session — a person using the web creator (or the dashboard); the avatar belongs to
/// their account (OwnerUserId), or they reach it through a Project they own.</item>
/// </list>
/// Ownership is enforced on every read/write; public avatars are readable anonymously via /public/{id}.
/// </summary>
[ApiController]
[Route("api/v1/avatars")]
[Authorize(AuthenticationSchemes = BothSchemes)]
public class AvatarsController(AvatarService avatarService, IProjectRepository projectRepository, IObjectStorage storage) : ControllerBase
{
    private const string BothSchemes = $"{ApiKeyAuthenticationDefaults.SchemeName},{DashboardAuthenticationDefaults.SchemeName}";
    private const long MaxThumbnailBytes = 1_000_000;

    [HttpPost]
    [ApiOperation("avatar.create")]
    public async Task<ActionResult<AvatarResponseDto>> Create([FromBody] CreateAvatarRequest request, CancellationToken ct)
    {
        var (userId, projectId) = CallerOwnership();
        var avatar = await avatarService.CreateAsync(userId, projectId, request, ct);
        return CreatedAtAction(nameof(GetById), new { id = avatar.Id }, avatar);
    }

    /// <summary>API key → that key's project's avatars. Cookie session → the signed-in account's own avatars ("My Avatars").</summary>
    [HttpGet]
    [ApiOperation("avatar.list")]
    public async Task<ActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var (userId, projectId) = CallerOwnership();
        return Ok(await avatarService.ListAsync(userId, projectId, page, pageSize, ct));
    }

    [HttpGet("{id:guid}")]
    [ApiOperation("avatar.read")]
    public async Task<ActionResult<AvatarResponseDto>> GetById(Guid id, CancellationToken ct)
    {
        var avatar = await avatarService.GetByIdAsync(id, ct);
        await EnsureAccessAsync(avatar, ct);
        return Ok(avatar);
    }

    [HttpPut("{id:guid}")]
    [ApiOperation("avatar.update")]
    public async Task<ActionResult<AvatarResponseDto>> Update(Guid id, [FromBody] UpdateAvatarRequest request, CancellationToken ct)
    {
        await EnsureAccessAsync(await avatarService.GetByIdAsync(id, ct), ct);
        return Ok(await avatarService.UpdateAsync(id, request, ct));
    }

    [HttpDelete("{id:guid}")]
    [ApiOperation("avatar.delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await EnsureAccessAsync(await avatarService.GetByIdAsync(id, ct), ct);
        var thumbnail = await avatarService.DeleteAsync(id, ct);
        await DeleteStoredFileAsync(thumbnail, ct);
        return NoContent();
    }

    /// <summary>CLAUDE.md §24 — just the configuration document (what an SDK needs to rebuild the avatar).</summary>
    [HttpGet("{id:guid}/configuration")]
    [ApiOperation("avatar.configuration.read")]
    public async Task<ActionResult<AvatarConfigurationDto>> GetConfiguration(Guid id, CancellationToken ct)
    {
        var avatar = await avatarService.GetByIdAsync(id, ct);
        await EnsureAccessAsync(avatar, ct);
        return Ok(avatar.Configuration);
    }

    [HttpPut("{id:guid}/configuration")]
    [ApiOperation("avatar.configuration.update")]
    public async Task<ActionResult<AvatarConfigurationDto>> PutConfiguration(Guid id, [FromBody] AvatarConfigurationDto configuration, CancellationToken ct)
    {
        await EnsureAccessAsync(await avatarService.GetByIdAsync(id, ct), ct);
        var updated = await avatarService.UpdateAsync(id, new UpdateAvatarRequest { Configuration = configuration }, ct);
        return Ok(updated.Configuration);
    }

    /// <summary>
    /// Raw PNG/WebP/JPEG body (not multipart), ≤ 1 MB. The web creator uploads a portrait it
    /// captures on save. The bytes are checked against real image signatures — the Content-Type
    /// header alone is never trusted — and stored under a server-generated name.
    /// </summary>
    [HttpPut("{id:guid}/thumbnail")]
    [RequestSizeLimit(MaxThumbnailBytes)]
    [ApiOperation("avatar.thumbnail.update")]
    public async Task<ActionResult<AvatarResponseDto>> PutThumbnail(Guid id, CancellationToken ct)
    {
        await EnsureAccessAsync(await avatarService.GetByIdAsync(id, ct), ct);

        using var buffer = new MemoryStream();
        await Request.Body.CopyToAsync(buffer, ct);
        if (buffer.Length == 0 || buffer.Length > MaxThumbnailBytes)
        {
            throw new ApiException(ErrorCodes.ValidationFailed, $"Thumbnail must be between 1 byte and {MaxThumbnailBytes / 1000} KB.", statusCode: 400);
        }
        var (extension, contentType) = DetectImage(buffer.GetBuffer().AsSpan(0, (int)buffer.Length))
            ?? throw new ApiException(ErrorCodes.ValidationFailed, "Thumbnail must be a PNG, WebP or JPEG image.", statusCode: 415);

        buffer.Position = 0;
        var url = await storage.SaveAsync($"thumbnails/{id:N}-{Guid.NewGuid():N}{extension}", buffer, contentType, ct);
        var (avatar, previous) = await avatarService.SetThumbnailAsync(id, url, ct);
        await DeleteStoredFileAsync(previous, ct);
        return Ok(avatar);
    }

    [HttpPost("{id:guid}/render")]
    [ApiOperation("avatar.render")]
    public async Task<ActionResult> Render(Guid id, [FromBody] RenderAvatarRequest request, [FromServices] IAvatarRenderer renderer, CancellationToken ct)
    {
        var avatar = await avatarService.GetByIdAsync(id, ct);
        await EnsureAccessAsync(avatar, ct);
        return Ok(await RenderAsync(avatar, request, renderer, ct));
    }

    /// <summary>CLAUDE.md §28: <c>POST /api/v1/avatars/render</c> with <c>{ avatarId, animation, camera, background, format }</c>.</summary>
    [HttpPost("render")]
    [ApiOperation("avatar.render")]
    public async Task<ActionResult> RenderById([FromBody] RenderByIdRequest request, [FromServices] IAvatarRenderer renderer, CancellationToken ct)
    {
        var avatar = await avatarService.GetByIdAsync(request.AvatarId, ct);
        await EnsureAccessAsync(avatar, ct);
        return Ok(await RenderAsync(avatar, request, renderer, ct));
    }

    [HttpPost("{id:guid}/export")]
    [ApiOperation("avatar.export")]
    public async Task<ActionResult> Export(Guid id, [FromBody] ExportAvatarRequest request, [FromServices] IAvatarRenderer renderer, CancellationToken ct)
    {
        var avatar = await avatarService.GetByIdAsync(id, ct);
        await EnsureAccessAsync(avatar, ct);
        if (!string.Equals(request.Format, "glb", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException(ErrorCodes.ValidationFailed, "format must be \"glb\" (use /render for png).", statusCode: 400);
        }
        var result = await renderer.ExportGlbAsync(avatar.Configuration, new ExportOptions { IncludeAnimations = request.IncludeAnimations }, ct);
        return Ok(new { status = "completed", url = result.Url, format = result.Format });
    }

    /// <summary>Read-only, no owner info, only for avatars explicitly marked Public.</summary>
    [HttpGet("public/{id:guid}")]
    [AllowAnonymous]
    [ApiOperation("avatar.read_public")]
    public async Task<ActionResult> GetPublic(Guid id, CancellationToken ct)
    {
        var avatar = await avatarService.GetByIdAsync(id, ct);
        if (avatar.Visibility != nameof(AvatarVisibility.Public))
        {
            throw new ApiException(ErrorCodes.AvatarNotFound, $"Avatar '{id}' does not exist.", statusCode: 404);
        }
        return Ok(new { avatar.Id, avatar.Name, avatar.Configuration, avatar.ThumbnailUrl, avatar.UpdatedAt });
    }

    private static async Task<object> RenderAsync(AvatarResponseDto avatar, RenderAvatarRequest request, IAvatarRenderer renderer, CancellationToken ct)
    {
        if (!string.Equals(request.Format, "png", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException(ErrorCodes.ValidationFailed, "format must be \"png\" (use /export for glb).", statusCode: 400);
        }
        var background = request.Background ?? (request.Transparent == false ? "#FFFFFF" : "transparent");
        var result = await renderer.RenderPngAsync(avatar.Configuration, new RenderOptions
        {
            Width = request.Width,
            Height = request.Height,
            Background = background,
            Camera = request.Camera,
            Animation = request.Animation,
            Time = request.Time,
        }, ct);
        return new { status = "completed", url = result.Url, format = result.Format };
    }

    /// <summary>Exactly one owner is recorded: the API key's project, or else the signed-in account.</summary>
    private (Guid? UserId, Guid? ProjectId) CallerOwnership()
    {
        if (HttpContext.Items["ApiKey"] is ApiKey apiKey) return (null, apiKey.ProjectId);
        if (TryGetSessionUserId(out var userId)) return (userId, null);
        throw new ApiException(ErrorCodes.Unauthorized, "Authentication required.", statusCode: 401);
    }

    private bool TryGetSessionUserId(out Guid userId)
    {
        userId = Guid.Empty;
        return User.Identity?.IsAuthenticated == true && Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
    }

    private async Task EnsureAccessAsync(AvatarResponseDto avatar, CancellationToken ct)
    {
        if (HttpContext.Items["ApiKey"] is ApiKey apiKey)
        {
            // Legacy avatars (created before OwnerProjectId existed and not owned by an account) stay reachable, per Phase 7's docs.
            if (avatar.OwnerProjectId == apiKey.ProjectId || (avatar.OwnerProjectId is null && avatar.OwnerUserId is null)) return;
            throw new ApiException(ErrorCodes.Forbidden, "This API key does not have access to this avatar.", statusCode: 403);
        }

        if (TryGetSessionUserId(out var userId))
        {
            if (avatar.OwnerUserId == userId) return;
            if (avatar.OwnerProjectId is not null)
            {
                var project = await projectRepository.GetByIdAsync(avatar.OwnerProjectId.Value, ct);
                if (project?.UserId == userId) return;
            }
            throw new ApiException(ErrorCodes.Forbidden, "You do not have access to this avatar.", statusCode: 403);
        }

        throw new ApiException(ErrorCodes.Unauthorized, "Authentication required.", statusCode: 401);
    }

    private async Task DeleteStoredFileAsync(string? publicUrl, CancellationToken ct)
    {
        if (publicUrl is null) return;
        var relative = storage.ToRelativePath(publicUrl);
        if (relative is not null) await storage.DeleteAsync(relative, ct);
    }

    private static (string Extension, string ContentType)? DetectImage(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 8 && bytes[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return (".png", "image/png");
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8)) return (".webp", "image/webp");
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) return (".jpg", "image/jpeg");
        return null;
    }
}
