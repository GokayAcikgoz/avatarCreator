using System.Security.Claims;
using System.Text.Encodings.Web;
using AvatarForge.Application.ApiKeys;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace AvatarForge.Api.Authentication;

public static class ApiKeyAuthenticationDefaults
{
    public const string SchemeName = "ApiKey";
    public const string HeaderName = "X-API-Key";
}

/// <summary>CLAUDE.md section 11 — X-API-Key header auth. On success, stashes the resolved ApiKey/ProjectId in HttpContext.Items for downstream usage tracking + rate limiting to read without re-querying.</summary>
public class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    ApiKeyService apiKeyService
) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(ApiKeyAuthenticationDefaults.HeaderName, out var headerValues))
        {
            return AuthenticateResult.Fail("Missing X-API-Key header.");
        }

        var providedKey = headerValues.FirstOrDefault();
        var apiKey = await apiKeyService.ValidateAsync(providedKey, Context.RequestAborted);
        if (apiKey is null)
        {
            return AuthenticateResult.Fail("Invalid or revoked API key.");
        }

        Context.Items["ApiKey"] = apiKey;

        var claims = new[]
        {
            new Claim("project_id", apiKey.ProjectId.ToString()),
            new Claim("api_key_id", apiKey.Id.ToString()),
        };
        var identity = new ClaimsIdentity(claims, ApiKeyAuthenticationDefaults.SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, ApiKeyAuthenticationDefaults.SchemeName);
        return AuthenticateResult.Success(ticket);
    }
}
