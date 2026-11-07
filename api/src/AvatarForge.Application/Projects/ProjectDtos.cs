namespace AvatarForge.Application.Projects;

/// <summary>The owner is always the signed-in caller — never taken from the request body.</summary>
public class CreateProjectRequest
{
    public string Name { get; set; } = string.Empty;
}

public class UpdateProjectRequest
{
    public string Name { get; set; } = string.Empty;
}

public class ProjectResponseDto
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}
