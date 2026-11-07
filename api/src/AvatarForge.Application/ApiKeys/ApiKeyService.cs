using System.Security.Cryptography;
using System.Text;
using AvatarForge.Application.Common;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.ApiKeys;

public class ApiKeyService(IApiKeyRepository repository)
{
    private const string Prefix = "af_live_";

    public async Task<ApiKeyCreatedResponseDto> CreateAsync(Guid projectId, CreateApiKeyRequest request, CancellationToken ct = default)
    {
        var project = await repository.GetProjectAsync(projectId, ct)
            ?? throw new ApiException(ErrorCodes.ProjectNotFound, $"Project '{projectId}' does not exist.", statusCode: 404);

        var secret = GenerateSecret();
        var plaintextKey = Prefix + secret;
        var keyPrefix = Prefix + secret[..8];

        var apiKey = new ApiKey
        {
            Id = Guid.NewGuid(),
            ProjectId = project.Id,
            Name = string.IsNullOrWhiteSpace(request.Name) ? "Unnamed key" : request.Name,
            KeyPrefix = keyPrefix,
            KeyHash = Hash(plaintextKey),
            RateLimitPerMinute = request.RateLimitPerMinute is > 0 ? request.RateLimitPerMinute.Value : 60,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        await repository.AddAsync(apiKey, ct);
        await repository.SaveChangesAsync(ct);

        // The plaintext key is returned exactly once, here, and never persisted or logged again.
        return new ApiKeyCreatedResponseDto
        {
            Id = apiKey.Id,
            Name = apiKey.Name,
            Key = plaintextKey,
            KeyPrefix = apiKey.KeyPrefix,
            RateLimitPerMinute = apiKey.RateLimitPerMinute,
            CreatedAt = apiKey.CreatedAt,
        };
    }

    /// <summary>Used by the X-API-Key auth handler on every request. Returns null on any mismatch — never distinguishes "not found" from "revoked" to the caller.</summary>
    public async Task<ApiKey?> ValidateAsync(string? plaintextKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(plaintextKey) || !plaintextKey.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return null;
        }

        var key = await repository.GetByHashAsync(Hash(plaintextKey), ct);
        return key is { IsActive: true } ? key : null;
    }

    public async Task<List<ApiKeyResponseDto>> ListForProjectAsync(Guid projectId, CancellationToken ct = default)
    {
        var keys = await repository.ListForProjectAsync(projectId, ct);
        return keys.Select(ToDto).ToList();
    }

    /// <summary>Immediately invalidates the key — the next request carrying it fails auth (ApiKeyAuthenticationHandler only accepts IsActive keys). Dashboard-only; ownership of the containing project must be checked by the caller before this runs.</summary>
    public async Task RevokeAsync(Guid projectId, Guid keyId, CancellationToken ct = default)
    {
        var key = await repository.GetByIdAsync(keyId, ct);
        if (key is null || key.ProjectId != projectId)
        {
            throw new ApiException("API_KEY_NOT_FOUND", $"API key '{keyId}' does not exist on this project.", statusCode: 404);
        }
        key.IsActive = false;
        key.RevokedAt = DateTimeOffset.UtcNow;
        await repository.SaveChangesAsync(ct);
    }

    private static ApiKeyResponseDto ToDto(ApiKey key) => new()
    {
        Id = key.Id,
        Name = key.Name,
        KeyPrefix = key.KeyPrefix,
        IsActive = key.IsActive,
        RateLimitPerMinute = key.RateLimitPerMinute,
        CreatedAt = key.CreatedAt,
        LastUsedAt = key.LastUsedAt,
    };

    private static string GenerateSecret()
    {
        Span<byte> bytes = stackalloc byte[24];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string Hash(string plaintext)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(plaintext));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
