using System.Security.Claims;
using AvatarForge.Api.Authentication;
using AvatarForge.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AvatarForge.Api.Controllers;

/// <summary>Dashboard session auth (CLAUDE.md Phase 8 §2) — secure HTTP-only cookie, never an X-API-Key. See AssetsController/AvatarsController for the separate developer-facing API key auth.</summary>
[ApiController]
[Route("api/v1/auth")]
public class AuthController(AuthService authService) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<AuthUserResponseDto>> Register([FromBody] RegisterRequest request, CancellationToken ct) =>
        Ok(await authService.RegisterAsync(request, ct));

    [HttpPost("login")]
    public async Task<ActionResult<AuthUserResponseDto>> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        var user = await authService.ValidateCredentialsAsync(request, ct);
        if (user is null)
        {
            return Unauthorized(new { error = new { code = "INVALID_CREDENTIALS", message = "Incorrect email or password." } });
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
        };
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await HttpContext.SignInAsync(DashboardAuthenticationDefaults.SchemeName, new ClaimsPrincipal(identity), new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddDays(14),
        });

        return Ok(new AuthUserResponseDto { Id = user.Id, Email = user.Email });
    }

    [HttpPost("logout")]
    [Authorize(AuthenticationSchemes = DashboardAuthenticationDefaults.SchemeName)]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(DashboardAuthenticationDefaults.SchemeName);
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize(AuthenticationSchemes = DashboardAuthenticationDefaults.SchemeName)]
    public IActionResult Me()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var email = User.FindFirstValue(ClaimTypes.Email);
        return Ok(new AuthUserResponseDto { Id = Guid.Parse(id!), Email = email! });
    }
}
