using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Avatars;

public interface IAvatarRepository
{
    Task<Avatar?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<(List<Avatar> Items, int Total)> ListAsync(Guid? ownerUserId, Guid? ownerProjectId, int page, int pageSize, CancellationToken ct = default);
    Task<int> CountByOwnerUserAsync(Guid ownerUserId, CancellationToken ct = default);
    Task AddAsync(Avatar avatar, CancellationToken ct = default);
    Task DeleteAsync(Avatar avatar, CancellationToken ct = default);
    Task SaveChangesAsync(CancellationToken ct = default);
}
