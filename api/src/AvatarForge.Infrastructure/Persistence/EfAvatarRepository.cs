using AvatarForge.Application.Avatars;
using AvatarForge.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AvatarForge.Infrastructure.Persistence;

public class EfAvatarRepository(AvatarForgeDbContext db) : IAvatarRepository
{
    public Task<Avatar?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        db.Avatars.FirstOrDefaultAsync(a => a.Id == id, ct);

    public async Task<(List<Avatar> Items, int Total)> ListAsync(Guid? ownerUserId, Guid? ownerProjectId, int page, int pageSize, CancellationToken ct = default)
    {
        var query = db.Avatars.AsQueryable();
        if (ownerUserId is not null) query = query.Where(a => a.OwnerUserId == ownerUserId);
        if (ownerProjectId is not null) query = query.Where(a => a.OwnerProjectId == ownerProjectId);

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderByDescending(a => a.UpdatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return (items, total);
    }

    public Task<int> CountByOwnerUserAsync(Guid ownerUserId, CancellationToken ct = default) =>
        db.Avatars.CountAsync(a => a.OwnerUserId == ownerUserId, ct);

    public async Task AddAsync(Avatar avatar, CancellationToken ct = default) => await db.Avatars.AddAsync(avatar, ct);

    public Task DeleteAsync(Avatar avatar, CancellationToken ct = default)
    {
        db.Avatars.Remove(avatar);
        return Task.CompletedTask;
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
