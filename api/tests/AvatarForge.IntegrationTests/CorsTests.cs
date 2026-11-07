namespace AvatarForge.IntegrationTests;

/// <summary>CLAUDE.md Phase 8 §8 — allowed origins come from configuration (Cors:AllowedOrigins / API_ALLOWED_ORIGINS), never a wildcard.</summary>
public class CorsTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    [Fact]
    public async Task Preflight_from_the_configured_origin_is_allowed()
    {
        var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/assets");
        request.Headers.Add("Origin", "http://localhost:3000");
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await client.SendAsync(request);

        Assert.True(response.Headers.TryGetValues("Access-Control-Allow-Origin", out var origins));
        Assert.Equal("http://localhost:3000", origins!.First());
    }

    [Fact]
    public async Task Preflight_from_an_unconfigured_origin_gets_no_cors_headers()
    {
        var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/assets");
        request.Headers.Add("Origin", "http://evil.example.com");
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await client.SendAsync(request);

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
