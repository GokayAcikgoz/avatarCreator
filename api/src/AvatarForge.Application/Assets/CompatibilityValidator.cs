using AvatarForge.Application.Common;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Assets;

/// <summary>
/// Ports the exact same rule as the frontend's isIncompatible (src/features/avatar/config/
/// assetManifest.ts) — CLAUDE.md section 17 requires the server enforce this independently,
/// not trust client-side validation alone.
/// </summary>
public class CompatibilityValidator(IAssetRepository assetRepository)
{
    public async Task ValidateAsync(IEnumerable<string?> selectedAssetIds, CancellationToken ct = default)
    {
        var ids = selectedAssetIds.Where(id => !string.IsNullOrEmpty(id)).Cast<string>().Distinct().ToList();
        if (ids.Count < 2) return;

        var assets = await assetRepository.GetByIdsAsync(ids, ct);
        var byId = assets.ToDictionary(a => a.Id);

        var violations = new List<object>();
        for (var i = 0; i < ids.Count; i++)
        {
            for (var j = i + 1; j < ids.Count; j++)
            {
                var a = byId.GetValueOrDefault(ids[i]);
                var b = byId.GetValueOrDefault(ids[j]);
                if (a is null || b is null) continue;

                var incompatible = a.IncompatibleWith.Contains(b.Id) || b.IncompatibleWith.Contains(a.Id);
                if (incompatible)
                {
                    violations.Add(new { assetA = a.Id, assetB = b.Id });
                }
            }
        }

        if (violations.Count > 0)
        {
            throw new ApiException(
                ErrorCodes.IncompatibleAssets,
                "The provided asset selection contains incompatible assets.",
                statusCode: 400,
                details: new { violations }
            );
        }
    }
}
