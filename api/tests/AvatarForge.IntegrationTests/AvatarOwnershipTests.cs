using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

public class AvatarOwnershipTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    [Fact]
    public async Task Avatar_created_via_api_key_is_linked_to_that_keys_project()
    {
        var client = factory.CreateClient();
        var (_, projectId, key) = await TestHelpers.CreateProjectWithApiKeyAsync(factory);

        using var create = new HttpRequestMessage(HttpMethod.Post, "/api/v1/avatars")
        {
            Content = JsonContent.Create(new { name = "Owned Avatar", configuration = TestHelpers.DefaultConfiguration() }),
        };
        create.Headers.Add("X-API-Key", key);
        var response = await client.SendAsync(create);
        response.EnsureSuccessStatusCode();
        var avatar = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(projectId, avatar.GetProperty("ownerProjectId").GetGuid());
    }

    [Fact]
    public async Task Dashboard_owner_can_view_an_avatar_created_by_their_projects_key()
    {
        var client = factory.CreateClient();
        var (userId, projectId, key) = await TestHelpers.CreateProjectWithApiKeyAsync(factory);

        // CreateProjectWithApiKeyAsync's owner lives on a throwaway client, so this test signs in a
        // second dashboard user here, creates a project and key under that session, then creates
        // the avatar under that project's key.
        var (dashUserId, cookie) = await TestHelpers.RegisterAndLoginAsync(client);
        var projectResp = await client.PostAsJsonAsync("/api/v1/projects", new { name = "Dash Owned" });
        var project = await projectResp.Content.ReadFromJsonAsync<JsonElement>();
        var dashProjectId = project.GetProperty("id").GetGuid();
        var keyResp = await client.PostAsJsonAsync($"/api/v1/projects/{dashProjectId}/api-keys", new { name = "k" });
        var keyJson = await keyResp.Content.ReadFromJsonAsync<JsonElement>();
        var dashKey = keyJson.GetProperty("key").GetString()!;

        using var create = new HttpRequestMessage(HttpMethod.Post, "/api/v1/avatars")
        {
            Content = JsonContent.Create(new { name = "Dash Avatar", configuration = TestHelpers.DefaultConfiguration() }),
        };
        create.Headers.Add("X-API-Key", dashKey);
        var createResponse = await client.SendAsync(create);
        var avatar = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var avatarId = avatar.GetProperty("id").GetGuid();

        using var getViaCookie = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/avatars/{avatarId}");
        getViaCookie.Headers.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(getViaCookie)).StatusCode);

        // sanity: unrelated bootstrap ids from the top of this test are not the ones granting access
        Assert.NotEqual(userId, dashUserId);
        Assert.NotEqual(projectId, dashProjectId);
    }

    [Fact]
    public async Task A_different_api_key_cannot_read_another_projects_avatar()
    {
        var client = factory.CreateClient();
        var (_, _, keyA) = await TestHelpers.CreateProjectWithApiKeyAsync(factory);
        var (_, _, keyB) = await TestHelpers.CreateProjectWithApiKeyAsync(factory);

        using var create = new HttpRequestMessage(HttpMethod.Post, "/api/v1/avatars")
        {
            Content = JsonContent.Create(new { name = "A's Avatar", configuration = TestHelpers.DefaultConfiguration() }),
        };
        create.Headers.Add("X-API-Key", keyA);
        var createResponse = await client.SendAsync(create);
        var avatar = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var avatarId = avatar.GetProperty("id").GetGuid();

        using var getWithB = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/avatars/{avatarId}");
        getWithB.Headers.Add("X-API-Key", keyB);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(getWithB)).StatusCode);
    }

    [Fact]
    public async Task Public_endpoint_hides_private_avatars_and_reveals_public_ones()
    {
        var client = factory.CreateClient();
        var (_, _, key) = await TestHelpers.CreateProjectWithApiKeyAsync(factory);

        using var create = new HttpRequestMessage(HttpMethod.Post, "/api/v1/avatars")
        {
            Content = JsonContent.Create(new { name = "Maybe Public", configuration = TestHelpers.DefaultConfiguration() }),
        };
        create.Headers.Add("X-API-Key", key);
        var createResponse = await client.SendAsync(create);
        var avatar = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var avatarId = avatar.GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/avatars/public/{avatarId}")).StatusCode);

        using var makePublic = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/avatars/{avatarId}")
        {
            Content = JsonContent.Create(new { visibility = "Public" }),
        };
        makePublic.Headers.Add("X-API-Key", key);
        (await client.SendAsync(makePublic)).EnsureSuccessStatusCode();

        var publicResponse = await client.GetAsync($"/api/v1/avatars/public/{avatarId}");
        Assert.Equal(HttpStatusCode.OK, publicResponse.StatusCode);
        var body = await publicResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.TryGetProperty("ownerProjectId", out _), "Public endpoint must not leak owner info.");
    }
}
