using AvatarForge.Api.Authentication;
using AvatarForge.Api.Middleware;
using AvatarForge.Application.Assets;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AvatarForge.Api.Controllers;

/// <summary>Accepts either scheme — the developer API key (usage-tracked) or a dashboard cookie session (used only for the dashboard's read-only asset-count stat, never tracked as project usage since it isn't tied to any one key).</summary>
[ApiController]
[Route("api/v1/assets")]
[Authorize(AuthenticationSchemes = $"{ApiKeyAuthenticationDefaults.SchemeName},{DashboardAuthenticationDefaults.SchemeName}")]
public class AssetsController(AssetCatalogService catalogService) : ControllerBase
{
    /// <summary>CLAUDE.md section 4 — filterable by category/slot/search, paginated.</summary>
    [HttpGet]
    [ApiOperation("asset.list")]
    public async Task<ActionResult> List([FromQuery] string? category, [FromQuery] string? slot, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var result = await catalogService.ListAsync(new AssetListQuery { Category = category, Slot = slot, Search = search, Page = page, PageSize = pageSize }, ct);
        return Ok(result);
    }

    [HttpGet("{id}")]
    [ApiOperation("asset.read")]
    public async Task<ActionResult<AssetResponseDto>> GetById(string id, CancellationToken ct) =>
        Ok(await catalogService.GetByIdAsync(id, ct));
}
