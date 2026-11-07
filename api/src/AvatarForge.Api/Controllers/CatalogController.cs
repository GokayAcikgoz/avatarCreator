using AvatarForge.Api.Middleware;
using AvatarForge.Application.Catalog;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AvatarForge.Api.Controllers;

/// <summary>
/// Static, public reference data an SDK needs to build its own avatar editor on top of the API:
/// editor categories/palettes/body types, curated presets, facial expressions and the animation
/// library. Anonymous (it's the same data the public web creator ships), but calls made with an
/// X-API-Key are still attributed to that key's project for usage stats.
/// </summary>
[ApiController]
[Route("api/v1")]
[AllowAnonymous]
public class CatalogController : ControllerBase
{
    [HttpGet("catalog")]
    [ApiOperation("catalog.read")]
    public IActionResult GetCatalog() => Ok(new
    {
        categories = SharedCatalog.Categories,
        palettes = SharedCatalog.Palettes,
        bodyTypes = SharedCatalog.BodyTypes,
    });

    [HttpGet("presets")]
    [ApiOperation("preset.list")]
    public IActionResult GetPresets() => Ok(new { items = SharedCatalog.Presets });

    [HttpGet("expressions")]
    [ApiOperation("expression.list")]
    public IActionResult GetExpressions() => Ok(new { items = SharedCatalog.Expressions });

    /// <summary>Animation library. Metadata by default; <c>?include=tracks</c> adds the full keyframe data (bone-local quaternion deltas, see docs).</summary>
    [HttpGet("animations")]
    [ApiOperation("animation.list")]
    public IActionResult GetAnimations([FromQuery] string? include = null)
    {
        var withTracks = string.Equals(include, "tracks", StringComparison.OrdinalIgnoreCase);
        var library = SharedCatalog.Animations;
        return Ok(new
        {
            fps = library.Fps,
            items = library.Clips.Select(c => new
            {
                c.Id,
                c.Name,
                c.Icon,
                c.Duration,
                c.Loop,
                c.FadeIn,
                c.Expression,
                c.Frames,
                Tracks = withTracks ? c.Tracks : null,
                Root = withTracks ? c.Root : null,
            }),
        });
    }

    [HttpGet("animations/{id}")]
    [ApiOperation("animation.read")]
    public IActionResult GetAnimation(string id)
    {
        var clip = SharedCatalog.FindAnimation(id);
        return clip is null
            ? NotFound(new { error = new { code = "ANIMATION_NOT_FOUND", message = $"Animation '{id}' does not exist." } })
            : Ok(clip);
    }
}
