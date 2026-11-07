using AvatarForge.Application.Common;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Projects;

public class ProjectService(IProjectRepository repository)
{
    public async Task<ProjectResponseDto> CreateAsync(Guid ownerUserId, CreateProjectRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new ApiException(ErrorCodes.ValidationFailed, "Project name is required.", statusCode: 400);
        }

        var project = new Project
        {
            Id = Guid.NewGuid(),
            UserId = ownerUserId,
            Name = request.Name,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        await repository.AddAsync(project, ct);
        await repository.SaveChangesAsync(ct);
        return ToDto(project);
    }

    public async Task<ProjectResponseDto> GetByIdAsync(Guid id, Guid callerUserId, CancellationToken ct = default)
    {
        var project = await GetOrThrowAsync(id, ct);
        EnsureOwner(project, callerUserId);
        return ToDto(project);
    }

    public async Task<List<ProjectResponseDto>> ListMineAsync(Guid userId, CancellationToken ct = default)
    {
        var projects = await repository.ListByUserAsync(userId, ct);
        return projects.Select(ToDto).ToList();
    }

    /// <summary>Dashboard-only (cookie auth) — callerUserId must match the project's owner, checked here rather than trusted from the caller.</summary>
    public async Task<ProjectResponseDto> RenameAsync(Guid id, Guid callerUserId, UpdateProjectRequest request, CancellationToken ct = default)
    {
        var project = await GetOrThrowAsync(id, ct);
        EnsureOwner(project, callerUserId);

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new ApiException(ErrorCodes.ValidationFailed, "Project name is required.", statusCode: 400);
        }
        project.Name = request.Name;
        await repository.SaveChangesAsync(ct);
        return ToDto(project);
    }

    public async Task DeleteAsync(Guid id, Guid callerUserId, CancellationToken ct = default)
    {
        var project = await GetOrThrowAsync(id, ct);
        EnsureOwner(project, callerUserId);
        await repository.DeleteAsync(project, ct);
        await repository.SaveChangesAsync(ct);
    }

    /// <summary>Used by controllers that need to verify ownership before delegating to another service (e.g. listing a project's avatars) without duplicating the not-found/403 logic.</summary>
    public async Task EnsureOwnerAsync(Guid projectId, Guid callerUserId, CancellationToken ct = default)
    {
        var project = await GetOrThrowAsync(projectId, ct);
        EnsureOwner(project, callerUserId);
    }

    private async Task<Project> GetOrThrowAsync(Guid id, CancellationToken ct) =>
        await repository.GetByIdAsync(id, ct)
            ?? throw new ApiException(ErrorCodes.ProjectNotFound, $"Project '{id}' does not exist.", statusCode: 404);

    private static void EnsureOwner(Project project, Guid callerUserId)
    {
        if (project.UserId != callerUserId)
        {
            throw new ApiException(ErrorCodes.Forbidden, "You do not have access to this project.", statusCode: 403);
        }
    }

    private static ProjectResponseDto ToDto(Project project) => new()
    {
        Id = project.Id,
        UserId = project.UserId,
        Name = project.Name,
        CreatedAt = project.CreatedAt,
    };
}
