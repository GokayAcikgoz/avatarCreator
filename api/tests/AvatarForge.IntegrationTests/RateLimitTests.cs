using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;

namespace AvatarForge.IntegrationTests;

public class RateLimitTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Exceeding_the_keys_configured_limit_returns_429()
    {
        // A deliberately tiny limit so the test doesn't need 60+ requests to prove the behavior.
        var (_, _, key) = await TestHelpers.CreateProjectWithApiKeyAsync(factory, rateLimitPerMinute: 3);

        var statusCodes = new List<HttpStatusCode>();
        for (var i = 0; i < 6; i++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/assets");
            request.Headers.Add("X-API-Key", key);
            var response = await _client.SendAsync(request);
            statusCodes.Add(response.StatusCode);
        }

        Assert.Contains(HttpStatusCode.OK, statusCodes);
        Assert.Contains(HttpStatusCode.TooManyRequests, statusCodes);
    }

    [Fact]
    public async Task Repeated_sign_in_attempts_from_one_address_are_throttled()
    {
        // The shared factory raises this limit so the rest of the suite can register freely;
        // this host puts the production-like ceiling back.
        await using var strictFactory = factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?> { ["RateLimiting:AuthAttemptsPerMinute"] = "3" })));
        var client = strictFactory.CreateClient();

        HttpResponseMessage? last = null;
        for (var i = 0; i < 6; i++)
        {
            last = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "nobody@avatarforge.test", password = "wrong-password" });
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, last!.StatusCode);
        Assert.True(last.Headers.Contains("Retry-After"));
    }
}
