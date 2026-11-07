using AvatarForge.Application.Projects;
using AvatarForge.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AvatarForge.Infrastructure.Persistence;

public class EfProjectRepository(AvatarForgeDbContext db) : IProjectRepository
{
    public Task<Project?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        db.Projects.FirstOrDefaultAsync(p => p.Id == id, ct);

    public Task<List<Project>> ListByUserAsync(Guid userId, CancellationToken ct = default) =>
        db.Projects.Where(p => p.UserId == userId).OrderByDescending(p => p.CreatedAt).ToListAsync(ct);

    public async Task AddAsync(Project project, CancellationToken ct = default) => await db.Projects.AddAsync(project, ct);

    public Task DeleteAsync(Project project, CancellationToken ct = default)
    {
        db.Projects.Remove(project);
        return Task.CompletedTask;
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
