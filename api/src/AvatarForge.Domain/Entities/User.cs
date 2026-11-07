namespace AvatarForge.Domain.Entities;

public class User
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;

    /// <summary>ASP.NET Core Identity's PBKDF2-based PasswordHasher output — never plaintext, never a reversible encoding. Null for users created via the bootstrap /users endpoint without a password (CLAUDE.md Phase 8 §2 keeps that path for non-dashboard, API-only use).</summary>
    public string? PasswordHash { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public List<Project> Projects { get; set; } = [];
    public List<Avatar> Avatars { get; set; } = [];
}
