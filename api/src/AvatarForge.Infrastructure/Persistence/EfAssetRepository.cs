using AvatarForge.Application.Assets;
using AvatarForge.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AvatarForge.Infrastructure.Persistence;

public class EfAssetRepository(AvatarForgeDbContext db) : IAssetRepository
{
    public Task<Asset?> GetByIdAsync(string id, CancellationToken ct = default) =>
        db.Assets.FirstOrDefaultAsync(a => a.Id == id, ct);

    public Task<List<Asset>> GetByIdsAsync(IEnumerable<string> ids, CancellationToken ct = default) =>
        db.Assets.Where(a => ids.Contains(a.Id)).ToListAsync(ct);

    public async Task<(List<Asset> Items, int Total)> QueryAsync(string? category, string? slot, string? search, int page, int pageSize, CancellationToken ct = default)
    {
        var query = db.Assets.AsQueryable();

        if (!string.IsNullOrWhiteSpace(category)) query = query.Where(a => a.Category == category);
        if (!string.IsNullOrWhiteSpace(slot)) query = query.Where(a => a.Slot == slot);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(a => a.Name.Contains(search));

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderBy(a => a.Category).ThenBy(a => a.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return (items, total);
    }
}
