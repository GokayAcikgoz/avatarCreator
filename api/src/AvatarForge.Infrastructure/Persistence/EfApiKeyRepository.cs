using AvatarForge.Application.ApiKeys;
using AvatarForge.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AvatarForge.Infrastructure.Persistence;

public class EfApiKeyRepository(AvatarForgeDbContext db) : IApiKeyRepository
{
    public Task<ApiKey?> GetByHashAsync(string keyHash, CancellationToken ct = default) =>
        db.ApiKeys.FirstOrDefaultAsync(k => k.KeyHash == keyHash, ct);

    public Task<ApiKey?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        db.ApiKeys.FirstOrDefaultAsync(k => k.Id == id, ct);

    public Task<List<ApiKey>> ListForProjectAsync(Guid projectId, CancellationToken ct = default) =>
        db.ApiKeys.Where(k => k.ProjectId == projectId).OrderByDescending(k => k.CreatedAt).ToListAsync(ct);

    public Task<Project?> GetProjectAsync(Guid projectId, CancellationToken ct = default) =>
        db.Projects.FirstOrDefaultAsync(p => p.Id == projectId, ct);

    public async Task AddAsync(ApiKey apiKey, CancellationToken ct = default) => await db.ApiKeys.AddAsync(apiKey, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
