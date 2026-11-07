using System.Text.Json;
using AvatarForge.Application.Assets;
using AvatarForge.Application.Common;
using AvatarForge.Domain.Configuration;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Avatars;

public class AvatarService(IAvatarRepository repository, CompatibilityValidator compatibilityValidator)
{
    public const int MaxNameLength = 80;
    /// <summary>Per-account cap for avatars saved from the web creator — keeps one account from filling the database.</summary>
    public const int MaxAvatarsPerUser = 200;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<AvatarResponseDto> CreateAsync(Guid? ownerUserId, Guid? ownerProjectId, CreateAvatarRequest request, CancellationToken ct = default)
    {
        await ValidateConfigurationAsync(request.Configuration, ct);
        var name = NormalizeName(request.Name) ?? "Untitled Avatar";

        if (ownerUserId is not null && await repository.CountByOwnerUserAsync(ownerUserId.Value, ct) >= MaxAvatarsPerUser)
        {
            throw new ApiException("AVATAR_LIMIT_REACHED", $"An account can save at most {MaxAvatarsPerUser} avatars. Delete one to save another.", statusCode: 409);
        }

        var now = DateTimeOffset.UtcNow;
        var avatar = new Avatar
        {
            Id = Guid.NewGuid(),
            OwnerUserId = ownerUserId,
            OwnerProjectId = ownerProjectId,
            Name = name,
            Visibility = request.Visibility,
            ConfigurationJson = JsonSerializer.Serialize(request.Configuration, JsonOptions),
            ConfigurationVersion = request.Configuration.Version,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await repository.AddAsync(avatar, ct);
        await repository.SaveChangesAsync(ct);
        return ToDto(avatar);
    }

    public async Task<AvatarResponseDto> GetByIdAsync(Guid id, CancellationToken ct = default) => ToDto(await GetOrThrowAsync(id, ct));

    public async Task<AvatarResponseDto> UpdateAsync(Guid id, UpdateAvatarRequest request, CancellationToken ct = default)
    {
        var avatar = await GetOrThrowAsync(id, ct);

        if (request.Name is not null) avatar.Name = NormalizeName(request.Name) ?? avatar.Name;
        if (request.Visibility is not null) avatar.Visibility = request.Visibility.Value;
        if (request.Configuration is not null)
        {
            await ValidateConfigurationAsync(request.Configuration, ct);
            avatar.ConfigurationJson = JsonSerializer.Serialize(request.Configuration, JsonOptions);
            avatar.ConfigurationVersion = request.Configuration.Version;
        }
        avatar.UpdatedAt = DateTimeOffset.UtcNow;

        await repository.SaveChangesAsync(ct);
        return ToDto(avatar);
    }

    /// <summary>Stores the new thumbnail URL and returns the previous one so the caller can delete the stale file.</summary>
    public async Task<(AvatarResponseDto Avatar, string? PreviousThumbnailUrl)> SetThumbnailAsync(Guid id, string thumbnailUrl, CancellationToken ct = default)
    {
        var avatar = await GetOrThrowAsync(id, ct);
        var previous = avatar.ThumbnailUrl;
        avatar.ThumbnailUrl = thumbnailUrl;
        await repository.SaveChangesAsync(ct);
        return (ToDto(avatar), previous);
    }

    public async Task<string?> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var avatar = await GetOrThrowAsync(id, ct);
        var thumbnail = avatar.ThumbnailUrl;
        await repository.DeleteAsync(avatar, ct);
        await repository.SaveChangesAsync(ct);
        return thumbnail;
    }

    public async Task<PagedResult<AvatarResponseDto>> ListAsync(Guid? ownerUserId, Guid? ownerProjectId, int page, int pageSize, CancellationToken ct = default)
    {
        // Never list across owners: an unscoped query would leak every avatar in the system.
        if (ownerUserId is null && ownerProjectId is null)
        {
            throw new ApiException(ErrorCodes.Forbidden, "Avatar listing must be scoped to a project or an account.", statusCode: 403);
        }

        page = page < 1 ? 1 : page;
        pageSize = pageSize is < 1 or > 100 ? 20 : pageSize;

        var (items, total) = await repository.ListAsync(ownerUserId, ownerProjectId, page, pageSize, ct);
        return new PagedResult<AvatarResponseDto>
        {
            Items = items.Select(ToDto).ToList(),
            Page = page,
            PageSize = pageSize,
            Total = total,
        };
    }

    private async Task<Avatar> GetOrThrowAsync(Guid id, CancellationToken ct) =>
        await repository.GetByIdAsync(id, ct)
            ?? throw new ApiException(ErrorCodes.AvatarNotFound, $"Avatar '{id}' does not exist.", statusCode: 404);

    private async Task ValidateConfigurationAsync(AvatarConfigurationDto configuration, CancellationToken ct)
    {
        AvatarConfigurationValidator.Validate(configuration);
        await compatibilityValidator.ValidateAsync(AvatarConfigurationValidator.SelectedAssetIds(configuration), ct);
    }

    private static string? NormalizeName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var trimmed = name.Trim();
        if (trimmed.Length > MaxNameLength)
        {
            throw new ApiException(ErrorCodes.ValidationFailed, $"name must be at most {MaxNameLength} characters.", statusCode: 400);
        }
        return trimmed;
    }

    private static AvatarResponseDto ToDto(Avatar avatar) => new()
    {
        Id = avatar.Id,
        Name = avatar.Name,
        Visibility = avatar.Visibility.ToString(),
        Configuration = JsonSerializer.Deserialize<AvatarConfigurationDto>(avatar.ConfigurationJson, JsonOptions) ?? new AvatarConfigurationDto(),
        ThumbnailUrl = avatar.ThumbnailUrl,
        OwnerProjectId = avatar.OwnerProjectId,
        OwnerUserId = avatar.OwnerUserId,
        CreatedAt = avatar.CreatedAt,
        UpdatedAt = avatar.UpdatedAt,
    };
}
