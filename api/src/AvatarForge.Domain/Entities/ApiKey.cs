namespace AvatarForge.Domain.Entities;

/// <summary>
/// Only the SHA-256 hash of the key is ever persisted (CLAUDE.md section 9 — "database'de
/// plaintext API key saklama"). The plaintext value is generated once, returned to the caller,
/// and never stored or logged. <see cref="KeyPrefix"/> (e.g. "af_live_ab12") is kept so a UI can
/// show "which key is this" after creation without being able to reconstruct the secret.
/// </summary>
public class ApiKey
{
    public Guid Id { get; set; }
    public Guid ProjectId { get; set; }
    public Project? Project { get; set; }

    public string KeyPrefix { get; set; } = string.Empty;
    public string KeyHash { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;

    /// <summary>Requests/minute. Configurable per key (CLAUDE.md section 12 — "hardcode etme").</summary>
    public int RateLimitPerMinute { get; set; } = 60;

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
}
