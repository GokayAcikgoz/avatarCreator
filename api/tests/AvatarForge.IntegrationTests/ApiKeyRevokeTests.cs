using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

public class ApiKeyRevokeTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    [Fact]
    public async Task Revoked_key_is_rejected_on_its_next_use()
    {
        // Two separate clients on purpose: AssetsController accepts either the API key or a
        // dashboard cookie session (so the dashboard can show a live asset count). Using one
        // client for both would mean its auto-persisted login cookie (WebApplicationFactory's
        // CreateClient() keeps cookies by default) could authenticate the "after revoke" request
        // on its own, masking whether the key itself was actually rejected. `apiClient` here
        // never logs in, so it can only ever succeed via the X-API-Key header being valid —
        // exactly what a real external API consumer looks like.
        var dashboardClient = factory.CreateClient();
        var apiClient = factory.CreateClient();
        var (userId, cookie) = await TestHelpers.RegisterAndLoginAsync(dashboardClient);

        var projectResp = await dashboardClient.PostAsJsonAsync("/api/v1/projects", new { name = "Revoke Test" });
        var project = await projectResp.Content.ReadFromJsonAsync<JsonElement>();
        var projectId = project.GetProperty("id").GetGuid();

        var keyResp = await dashboardClient.PostAsJsonAsync($"/api/v1/projects/{projectId}/api-keys", new { name = "to be revoked" });
        var keyJson = await keyResp.Content.ReadFromJsonAsync<JsonElement>();
        var key = keyJson.GetProperty("key").GetString()!;
        var keyId = keyJson.GetProperty("id").GetGuid();

        using (var beforeRevoke = new HttpRequestMessage(HttpMethod.Get, "/api/v1/assets"))
        {
            beforeRevoke.Headers.Add("X-API-Key", key);
            Assert.Equal(HttpStatusCode.OK, (await apiClient.SendAsync(beforeRevoke)).StatusCode);
        }

        using (var revoke = new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/projects/{projectId}/api-keys/{keyId}"))
        {
            revoke.Headers.Add("Cookie", cookie);
            Assert.Equal(HttpStatusCode.NoContent, (await dashboardClient.SendAsync(revoke)).StatusCode);
        }

        using var afterRevoke = new HttpRequestMessage(HttpMethod.Get, "/api/v1/assets");
        afterRevoke.Headers.Add("X-API-Key", key);
        Assert.Equal(HttpStatusCode.Unauthorized, (await apiClient.SendAsync(afterRevoke)).StatusCode);
    }

    [Fact]
    public async Task Key_list_never_exposes_the_secret()
    {
        var client = factory.CreateClient();
        var (userId, cookie) = await TestHelpers.RegisterAndLoginAsync(client);
        var projectResp = await client.PostAsJsonAsync("/api/v1/projects", new { name = "List Test" });
        var project = await projectResp.Content.ReadFromJsonAsync<JsonElement>();
        var projectId = project.GetProperty("id").GetGuid();
        var createResp = await client.PostAsJsonAsync($"/api/v1/projects/{projectId}/api-keys", new { name = "k" });
        var created = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        var plaintextKey = created.GetProperty("key").GetString()!;

        using var list = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/projects/{projectId}/api-keys");
        list.Headers.Add("Cookie", cookie);
        var response = await client.SendAsync(list);
        var raw = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(plaintextKey, raw);
    }
}
