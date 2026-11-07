namespace AvatarForge.Application.Auth;

public class RegisterRequest
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class LoginRequest
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class AuthUserResponseDto
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
}
