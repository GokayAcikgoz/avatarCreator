using System.Net;

namespace AvatarForge.IntegrationTests;

public class ApiKeyAuthTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Request_without_api_key_is_rejected()
    {
        var response = await _client.GetAsync("/api/v1/assets");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Request_with_garbage_api_key_is_rejected()
    {
        _client.DefaultRequestHeaders.Add("X-API-Key", "af_live_this_is_not_a_real_key");
        var response = await _client.GetAsync("/api/v1/assets");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Request_with_valid_api_key_succeeds()
    {
        var key = await TestHelpers.CreateApiKeyAsync(factory);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/assets");
        request.Headers.Add("X-API-Key", key);

        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
