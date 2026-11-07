using System.Security.Claims;
using AvatarForge.Api.Authentication;
using AvatarForge.Application.ApiKeys;
using AvatarForge.Application.Avatars;
using AvatarForge.Application.Projects;
using AvatarForge.Application.Usage;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AvatarForge.Api.Controllers;

/// <summary>Developer dashboard: every action needs a signed-in session and acts only on the caller's own projects.</summary>
[ApiController]
[Route("api/v1/projects")]
[Authorize(AuthenticationSchemes = DashboardAuthenticationDefaults.SchemeName)]
public class ProjectsController(ProjectService projectService, ApiKeyService apiKeyService, AvatarService avatarService, UsageQueryService usageQueryService) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ProjectResponseDto>> Create([FromBody] CreateProjectRequest request, CancellationToken ct)
    {
        var project = await projectService.CreateAsync(CurrentUserId(), request, ct);
        return CreatedAtAction(nameof(GetById), new { id = project.Id }, project);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProjectResponseDto>> GetById(Guid id, CancellationToken ct) =>
        Ok(await projectService.GetByIdAsync(id, CurrentUserId(), ct));

    /// <summary>Dashboard's project list (CLAUDE.md Phase 8 §3) — cookie-authenticated, always scoped to the caller.</summary>
    [HttpGet]
    public async Task<ActionResult<List<ProjectResponseDto>>> ListMine(CancellationToken ct) =>
        Ok(await projectService.ListMineAsync(CurrentUserId(), ct));

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ProjectResponseDto>> Rename(Guid id, [FromBody] UpdateProjectRequest request, CancellationToken ct) =>
        Ok(await projectService.RenameAsync(id, CurrentUserId(), request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await projectService.DeleteAsync(id, CurrentUserId(), ct);
        return NoContent();
    }

    /// <summary>CLAUDE.md Phase 8 §18 — the dashboard's "my avatars" view, scoped per project (avatars are linked to the Project that created them via its API key, not directly to a User — see Avatar.OwnerProjectId).</summary>
    [HttpGet("{id:guid}/avatars")]
    public async Task<ActionResult> ListAvatars(Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        await projectService.EnsureOwnerAsync(id, CurrentUserId(), ct);
        return Ok(await avatarService.ListAsync(ownerUserId: null, ownerProjectId: id, page, pageSize, ct));
    }

    /// <summary>Returns the plaintext key exactly once (CLAUDE.md section 9) — the response is never reproducible after this call. Only the project's owner can mint keys for it.</summary>
    [HttpPost("{id:guid}/api-keys")]
    public async Task<ActionResult<ApiKeyCreatedResponseDto>> CreateApiKey(Guid id, [FromBody] CreateApiKeyRequest request, CancellationToken ct)
    {
        await projectService.EnsureOwnerAsync(id, CurrentUserId(), ct);
        return Ok(await apiKeyService.CreateAsync(id, request, ct));
    }

    /// <summary>Dashboard's key list — prefixes only, never the secret (CLAUDE.md Phase 8 §5).</summary>
    [HttpGet("{id:guid}/api-keys")]
    public async Task<ActionResult<List<ApiKeyResponseDto>>> ListApiKeys(Guid id, CancellationToken ct)
    {
        await projectService.EnsureOwnerAsync(id, CurrentUserId(), ct);
        return Ok(await apiKeyService.ListForProjectAsync(id, ct));
    }

    /// <summary>Revoked key is immediately rejected by ApiKeyAuthenticationHandler on its next use (CLAUDE.md Phase 8 §5).</summary>
    [HttpDelete("{id:guid}/api-keys/{keyId:guid}")]
    public async Task<IActionResult> RevokeApiKey(Guid id, Guid keyId, CancellationToken ct)
    {
        await projectService.EnsureOwnerAsync(id, CurrentUserId(), ct);
        await apiKeyService.RevokeAsync(id, keyId, ct);
        return NoContent();
    }

    /// <summary>CLAUDE.md Phase 8 §17 — real aggregates from ApiUsageEvent, never mock data.</summary>
    [HttpGet("{id:guid}/usage")]
    public async Task<ActionResult<UsageSummaryDto>> GetUsage(Guid id, CancellationToken ct)
    {
        await projectService.EnsureOwnerAsync(id, CurrentUserId(), ct);
        return Ok(await usageQueryService.GetSummaryAsync(id, ct));
    }

    private Guid CurrentUserId() => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
