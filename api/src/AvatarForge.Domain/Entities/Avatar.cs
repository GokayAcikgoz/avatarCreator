namespace AvatarForge.Domain.Entities;

/// <summary>
/// CLAUDE.md section 2/6: the AvatarConfiguration is the product's real domain object — this
/// entity stores it as a versioned JSON blob (<see cref="ConfigurationJson"/>), not a rendered
/// GLB. GLB/PNG are export formats derived from this on demand, never the source of truth.
/// </summary>
public class Avatar
{
    public Guid Id { get; set; }
    public Guid? OwnerUserId { get; set; }
    public User? OwnerUser { get; set; }

    /// <summary>
    /// Set from the authenticating ApiKey's ProjectId at creation time (CLAUDE.md Phase 8 §18/§23
    /// — closes the Phase 7-documented "avatars created via API key aren't linked to a Project"
    /// gap). Nullable because avatars created before this field existed have no value — treated
    /// as legacy/unowned, not as a bug, per AvatarsController's ownership check.
    /// </summary>
    public Guid? OwnerProjectId { get; set; }
    public Project? OwnerProject { get; set; }

    public string Name { get; set; } = "Untitled Avatar";

    /// <summary>Public URL (IObjectStorage) of a small portrait PNG the web creator captures on save — powers "My Avatars" galleries without re-rendering. Null until one is uploaded.</summary>
    public string? ThumbnailUrl { get; set; }
    public AvatarVisibility Visibility { get; set; } = AvatarVisibility.Private;

    /// <summary>Serialized AvatarConfigurationDto — see CLAUDE.md section 8 for the version-history rationale this leaves room for.</summary>
    public string ConfigurationJson { get; set; } = string.Empty;
    public int ConfigurationVersion { get; set; } = 1;

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
