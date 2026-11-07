namespace AvatarForge.Application.ApiKeys;

public class CreateApiKeyRequest
{
    public string Name { get; set; } = string.Empty;
    public int? RateLimitPerMinute { get; set; }
}

/// <summary>Only returned once, at creation time — the plaintext key can never be retrieved again (CLAUDE.md section 9).</summary>
public class ApiKeyCreatedResponseDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string KeyPrefix { get; set; } = string.Empty;
    public int RateLimitPerMinute { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class ApiKeyResponseDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string KeyPrefix { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public int RateLimitPerMinute { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
}
