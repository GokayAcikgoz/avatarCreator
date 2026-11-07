using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.ApiKeys;

public interface IApiKeyRepository
{
    Task<ApiKey?> GetByHashAsync(string keyHash, CancellationToken ct = default);
    Task<ApiKey?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<ApiKey>> ListForProjectAsync(Guid projectId, CancellationToken ct = default);
    Task<Project?> GetProjectAsync(Guid projectId, CancellationToken ct = default);
    Task AddAsync(ApiKey apiKey, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
