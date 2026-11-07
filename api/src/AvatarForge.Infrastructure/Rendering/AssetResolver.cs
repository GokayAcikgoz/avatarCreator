using AvatarForge.Application.Catalog;
using AvatarForge.Application.Common;
using AvatarForge.Application.Rendering;
using AvatarForge.Domain.Configuration;
using AvatarForge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AvatarForge.Infrastructure.Rendering;

/// <summary>
/// AvatarConfiguration -> real filesystem paths under BlenderOptions.ServerAssetsRoot, using the
/// same Asset rows the /assets API serves. Never touches a filesystem path supplied by a caller —
/// every path comes from a server constant or an Asset.ModelUrl seeded from the shared catalog,
/// re-verified to still resolve inside ServerAssetsRoot before it's handed to Blender.
/// </summary>
public class AssetResolver(AvatarForgeDbContext db, IOptions<BlenderOptions> options) : IAssetResolver
{
    public async Task<ResolvedAvatarAssets> ResolveAsync(AvatarConfigurationDto configuration, CancellationToken ct = default)
    {
        var root = options.Value.ServerAssetsRoot;

        // Eyebrows follow the hair color (darkened, as in the web viewer); a bald avatar falls back to the facial-hair color.
        var eyebrowSource = string.IsNullOrEmpty(configuration.Hair.Style) ? configuration.FacialHair.Color : configuration.Hair.Color;
        var eyebrowColor = Darken(eyebrowSource, SharedCatalog.RigSpec["eyebrows"]?["darkenFromHair"]?.GetValue<double>() ?? 0.35);

        var selections = new List<(string? AssetId, string? Color, string Role)>
        {
            (configuration.Hair.Style, configuration.Hair.Color, "clothing"),
            (configuration.FacialHair.BeardStyle, configuration.FacialHair.Color, "facialHair"),
            (configuration.FacialHair.MustacheStyle, configuration.FacialHair.Color, "facialHair"),
            (configuration.Clothing.Top, configuration.Clothing.TopColor, "clothing"),
            (configuration.Clothing.Bottom, configuration.Clothing.BottomColor, "clothing"),
            (configuration.Clothing.Shoes, configuration.Clothing.ShoesColor, "clothing"),
        };
        foreach (var accessoryId in configuration.Accessories)
        {
            configuration.AccessoryColors.TryGetValue(accessoryId, out var color);
            // Hats wrap the head like garments; glasses float in front of the face and must not be pushed out.
            var role = SharedCatalog.FindAsset(accessoryId)?.Slot == "head" ? "clothing" : "generic";
            selections.Add((accessoryId, color, role));
        }
        foreach (var part in SharedCatalog.Assets.Where(a => a.AlwaysOn))
        {
            var (color, role) = part.Slot switch
            {
                "eyes" => ((string?)null, "eyes"),
                "eyebrows" => (eyebrowColor, "generic"),
                _ => (null, "generic"),
            };
            selections.Add((part.Id, color, role));
        }

        var attachments = new List<ResolvedAttachment>();
        foreach (var (assetId, color, role) in selections)
        {
            if (string.IsNullOrEmpty(assetId)) continue;

            var asset = await db.Assets.AsNoTracking().FirstOrDefaultAsync(a => a.Id == assetId, ct)
                ?? throw new ApiException(ErrorCodes.AssetNotFound, $"Asset '{assetId}' referenced by this configuration does not exist.", statusCode: 400);

            if (string.IsNullOrEmpty(asset.ModelUrl))
            {
                throw new ApiException(ErrorCodes.InvalidConfiguration, $"Asset '{assetId}' has no model file and cannot be rendered.", statusCode: 400);
            }

            // Assets without a palette/colors aren't tintable (glasses lenses, the holiday hat) — never tint those.
            var tint = asset.Colors is { Count: > 0 } || asset.AlwaysOn ? color : null;

            // ModelUrl is "/models/attachments/foo.glb" — same relative layout under server-assets as under public/models.
            var relative = asset.ModelUrl.Replace("/models/", "", StringComparison.OrdinalIgnoreCase).TrimStart('/');
            attachments.Add(new ResolvedAttachment
            {
                Path = ResolveWithinRoot(root, relative),
                ColorHex = tint,
                Role = role,
                Layer = RigMath.GarmentLayer(SharedCatalog.FindAsset(assetId)),
                Slot = asset.Slot,
            });
        }

        var shapeKeys = new Dictionary<string, double>(configuration.Face.Morphs);
        foreach (var (name, value) in SharedCatalog.FindExpression(configuration.Face.Expression)?.Morphs ?? [])
        {
            shapeKeys[name] = value;
        }

        return new ResolvedAvatarAssets
        {
            BodyPath = ResolveWithinRoot(root, "avatar-base-poc.glb"),
            SkinTexturePath = ResolveWithinRoot(root, Path.Combine("textures", "skin_detail.webp")),
            Attachments = attachments,
            ShapeKeys = shapeKeys,
            SkinTone = configuration.Face.SkinTone,
            EyeColor = configuration.Face.EyeColor,
            HeightScale = RigMath.HeightScale(configuration.Body.Height),
            ShoulderFactor = RigMath.ShoulderFactor(configuration.Body.ShoulderWidth),
            LegFactor = RigMath.LegFactor(configuration.Body.Proportion),
        };
    }

    private static string Darken(string hex, double amount)
    {
        var value = hex.TrimStart('#');
        int Channel(int i) => (int)Math.Round(Convert.ToInt32(value.Substring(i, 2), 16) * (1 - amount));
        return $"#{Channel(0):X2}{Channel(2):X2}{Channel(4):X2}";
    }

    /// <summary>Defense in depth: even though every input here is server-controlled, re-verify the resolved path can't have escaped ServerAssetsRoot before it's handed to a subprocess.</summary>
    private static string ResolveWithinRoot(string root, string relativePath)
    {
        var rootFull = Path.GetFullPath(root);
        var combined = Path.GetFullPath(Path.Combine(rootFull, relativePath));
        if (!combined.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("INVALID_ASSET_PATH", "Resolved asset path escaped the server assets root.", statusCode: 500);
        }
        if (!File.Exists(combined))
        {
            throw new ApiException(ErrorCodes.AssetNotFound, $"Expected asset file not found on disk: {relativePath}", statusCode: 500);
        }
        return combined;
    }
}
