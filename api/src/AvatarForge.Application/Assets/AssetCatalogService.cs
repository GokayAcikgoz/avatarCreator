using AvatarForge.Application.Common;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Assets;

public class AssetCatalogService(IAssetRepository repository)
{
    public async Task<PagedResult<AssetResponseDto>> ListAsync(AssetListQuery query, CancellationToken ct = default)
    {
        var page = query.Page < 1 ? 1 : query.Page;
        var pageSize = query.PageSize is < 1 or > 100 ? 20 : query.PageSize;

        var (items, total) = await repository.QueryAsync(query.Category, query.Slot, query.Search, page, pageSize, ct);

        return new PagedResult<AssetResponseDto>
        {
            Items = items.Select(ToDto).ToList(),
            Page = page,
            PageSize = pageSize,
            Total = total,
        };
    }

    public async Task<AssetResponseDto> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var asset = await repository.GetByIdAsync(id, ct)
            ?? throw new ApiException(ErrorCodes.AssetNotFound, $"Asset '{id}' does not exist.", statusCode: 404);
        return ToDto(asset);
    }

    private static AssetResponseDto ToDto(Asset asset) => new()
    {
        Id = asset.Id,
        Name = asset.Name,
        Category = asset.Category,
        Slot = asset.Slot,
        Version = asset.AssetVersion ?? 1,
        ThumbnailUrl = asset.ThumbnailUrl,
        ModelUrl = asset.ModelUrl,
        CompatibleWith = asset.CompatibleWith,
        IncompatibleWith = asset.IncompatibleWith,
        Metadata = new Dictionary<string, object?>
        {
            ["tags"] = asset.Tags,
            ["styles"] = asset.Styles,
            ["alwaysOn"] = asset.AlwaysOn,
            ["colors"] = asset.Colors,
            ["license"] = asset.License,
            ["author"] = asset.Author,
            ["source"] = asset.Source,
            ["materials"] = asset.Materials,
            ["attachment"] = asset.Attachment,
        },
    };
}
