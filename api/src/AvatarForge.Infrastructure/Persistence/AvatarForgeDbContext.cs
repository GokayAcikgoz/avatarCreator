using AvatarForge.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace AvatarForge.Infrastructure.Persistence;

public class AvatarForgeDbContext(DbContextOptions<AvatarForgeDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();
    public DbSet<Avatar> Avatars => Set<Avatar>();
    public DbSet<Asset> Assets => Set<Asset>();
    public DbSet<ApiUsageEvent> ApiUsageEvents => Set<ApiUsageEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Email).IsUnique();
        });

        modelBuilder.Entity<Project>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.User).WithMany(u => u.Projects).HasForeignKey(x => x.UserId);
        });

        modelBuilder.Entity<ApiKey>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Project).WithMany(p => p.ApiKeys).HasForeignKey(x => x.ProjectId);
            e.HasIndex(x => x.KeyHash).IsUnique();
        });

        modelBuilder.Entity<Avatar>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasOne(x => x.OwnerUser).WithMany(u => u.Avatars).HasForeignKey(x => x.OwnerUserId).IsRequired(false);
            e.HasOne(x => x.OwnerProject).WithMany().HasForeignKey(x => x.OwnerProjectId).IsRequired(false);
        });

        modelBuilder.Entity<Asset>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Category);
            e.HasIndex(x => x.Slot);
        });

        modelBuilder.Entity<ApiUsageEvent>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.ProjectId, x.Timestamp });
        });
    }
}
