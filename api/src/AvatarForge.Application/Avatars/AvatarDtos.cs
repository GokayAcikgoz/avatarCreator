using System.Text.Json.Serialization;
using AvatarForge.Domain.Configuration;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Avatars;

public class CreateAvatarRequest
{
    public string? Name { get; set; }
    public AvatarConfigurationDto Configuration { get; set; } = new();
    public AvatarVisibility Visibility { get; set; } = AvatarVisibility.Private;
}

public class UpdateAvatarRequest
{
    public string? Name { get; set; }
    public AvatarConfigurationDto? Configuration { get; set; }
    public AvatarVisibility? Visibility { get; set; }
}

public class AvatarResponseDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Visibility { get; set; } = string.Empty;
    public AvatarConfigurationDto Configuration { get; set; } = new();
    public string? ThumbnailUrl { get; set; }
    /// <summary>Exposed so callers (controllers) can make ownership decisions — only the owning API key/dashboard session can reach a non-public avatar in the first place.</summary>
    public Guid? OwnerProjectId { get; set; }
    /// <summary>Internal: the web-creator account that owns this avatar (null for API-key-created avatars). Used for authorization, never serialized.</summary>
    [JsonIgnore]
    public Guid? OwnerUserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
