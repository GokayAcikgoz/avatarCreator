namespace AvatarForge.Domain.Entities;

/// <summary>
/// API keys belong to a Project, not directly to a User — a developer can separate
/// "My Game" from "My Fitness App" with independent keys and usage, per CLAUDE.md section 10.
/// </summary>
public class Project
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public User? User { get; set; }

    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }

    public List<ApiKey> ApiKeys { get; set; } = [];
}
