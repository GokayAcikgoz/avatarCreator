using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Assets;

public interface IAssetRepository
{
    Task<Asset?> GetByIdAsync(string id, CancellationToken ct = default);
    Task<List<Asset>> GetByIdsAsync(IEnumerable<string> ids, CancellationToken ct = default);
    Task<(List<Asset> Items, int Total)> QueryAsync(string? category, string? slot, string? search, int page, int pageSize, CancellationToken ct = default);
}
