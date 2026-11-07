using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace AvatarForge.IntegrationTests;

/// <summary>
/// The failure-path cases CLAUDE.md Phase 8 §22 explicitly asks for beyond the happy path already
/// covered in RenderExportTests: an avatar that doesn't exist, a Blender process that fails to run
/// at all, a render that times out, and confirmation that a request's temp working directory is
/// actually cleaned up rather than accumulating.
/// </summary>
[Collection(BlenderCollection.Name)]
public class RenderFailureTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    [Fact]
    public async Task Render_on_a_nonexistent_avatar_returns_404_not_a_500()
    {
        var client = factory.CreateClient();
        var key = await TestHelpers.CreateApiKeyAsync(factory);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/avatars/{Guid.NewGuid()}/render")
        {
            Content = JsonContent.Create(new { format = "png", width = 256, height = 256, transparent = true }),
        };
        request.Headers.Add("X-API-Key", key);

        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("AVATAR_NOT_FOUND", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_broken_Blender_script_path_produces_a_real_500_not_a_fake_success()
    {
        // A factory pointed at a script path that doesn't exist — Blender will exit non-zero
        // immediately. Real subprocess failure, not a simulated one.
        await using var brokenFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Blender:AssembleScriptPath"] = "D:\\this\\path\\does\\not\\exist.py",
                });
            });
        });
        var client = brokenFactory.CreateClient();
        var key = await TestHelpers.CreateApiKeyAsync(brokenFactory);

        var createResponse = await SendWithKey(client, HttpMethod.Post, "/api/v1/avatars", key,
            new { name = "Broken Render Test", configuration = TestHelpers.DefaultConfiguration() });
        var avatar = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var avatarId = avatar.GetProperty("id").GetGuid();

        var response = await SendWithKey(client, HttpMethod.Post, $"/api/v1/avatars/{avatarId}/render", key,
            new { format = "png", width = 256, height = 256, transparent = true });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("RENDER_FAILED", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_render_that_exceeds_its_configured_timeout_returns_504()
    {
        // 1 second is not enough for Blender to even finish starting up, let alone render —
        // deterministically forces the real timeout path (process kill + 504), not a simulation.
        await using var slowFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?> { ["Blender:TimeoutSeconds"] = "1" });
            });
        });
        var client = slowFactory.CreateClient();
        var key = await TestHelpers.CreateApiKeyAsync(slowFactory);

        var createResponse = await SendWithKey(client, HttpMethod.Post, "/api/v1/avatars", key,
            new { name = "Timeout Test", configuration = TestHelpers.DefaultConfiguration() });
        var avatar = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var avatarId = avatar.GetProperty("id").GetGuid();

        var response = await SendWithKey(client, HttpMethod.Post, $"/api/v1/avatars/{avatarId}/render", key,
            new { format = "png", width = 256, height = 256, transparent = true });

        Assert.Equal(HttpStatusCode.GatewayTimeout, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("RENDER_TIMEOUT", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Each_render_cleans_up_its_own_temp_directory()
    {
        var renderRoot = Path.Combine(Path.GetTempPath(), "avatarforge-render");
        var before = Directory.Exists(renderRoot) ? Directory.GetDirectories(renderRoot).Length : 0;

        var client = factory.CreateClient();
        var key = await TestHelpers.CreateApiKeyAsync(factory);
        var createResponse = await SendWithKey(client, HttpMethod.Post, "/api/v1/avatars", key,
            new { name = "Cleanup Test", configuration = TestHelpers.DefaultConfiguration() });
        var avatar = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var avatarId = avatar.GetProperty("id").GetGuid();

        var response = await SendWithKey(client, HttpMethod.Post, $"/api/v1/avatars/{avatarId}/render", key,
            new { format = "png", width = 256, height = 256, transparent = true });
        response.EnsureSuccessStatusCode();

        var after = Directory.Exists(renderRoot) ? Directory.GetDirectories(renderRoot).Length : 0;
        Assert.Equal(before, after);
    }

    private static async Task<HttpResponseMessage> SendWithKey(HttpClient client, HttpMethod method, string url, string key, object body)
    {
        using var request = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-API-Key", key);
        return await client.SendAsync(request);
    }
}
