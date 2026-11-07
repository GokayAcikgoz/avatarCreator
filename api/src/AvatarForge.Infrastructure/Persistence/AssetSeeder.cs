using AvatarForge.Application.Catalog;
using AvatarForge.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace AvatarForge.Infrastructure.Persistence;

/// <summary>
/// Synchronizes the Assets table with shared/asset-catalog.json on every boot — the same file the
/// web creator imports. Upsert, not "insert if empty": a catalog that grows (new hairstyles,
/// generated facial hair...) reaches existing databases without a manual migration, and edits to
/// an existing entry (name, colors, compatibility rules) are applied in place. Assets that
/// disappear from the catalog are deliberately NOT deleted — saved avatars may still reference them.
/// </summary>
public static class AssetSeeder
{
    public static async Task SeedAsync(AvatarForgeDbContext db, CancellationToken ct = default)
    {
        var existing = await db.Assets.ToDictionaryAsync(a => a.Id, ct);

        foreach (var source in SharedCatalog.Assets)
        {
            if (!existing.TryGetValue(source.Id, out var asset))
            {
                asset = new Asset { Id = source.Id };
                db.Assets.Add(asset);
            }

            asset.Name = source.Name;
            asset.Category = source.Category;
            asset.Slot = source.Slot;
            asset.ModelUrl = source.Model;
            asset.ThumbnailUrl = source.Thumbnail;
            asset.CompatibleWith = source.CompatibleWith;
            asset.IncompatibleWith = source.IncompatibleWith;
            asset.Tags = source.Tags;
            asset.Styles = source.Styles;
            asset.Colors = SharedCatalog.ResolveColors(source);
            asset.AlwaysOn = source.AlwaysOn;
            asset.AssetVersion = source.AssetVersion ?? 1;
            asset.License = source.License;
            asset.Author = source.Author;
            asset.Source = source.Source;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Several instances (horizontally-scaled API, or parallel integration-test hosts) booting
            // against one database can race to insert the same new ids. Losing that race means the
            // rows already exist — the desired end state — so it isn't an error.
            db.ChangeTracker.Clear();
        }
    }
}
