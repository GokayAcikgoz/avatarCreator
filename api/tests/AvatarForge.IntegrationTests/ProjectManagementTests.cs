using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

public class ProjectManagementTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private static HttpRequestMessage WithCookie(HttpMethod method, string url, string cookie)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("Cookie", cookie);
        return request;
    }

    private async Task<(HttpClient client, Guid userId, string cookie, Guid projectId)> SetupOwnedProjectAsync()
    {
        var client = factory.CreateClient();
        var (userId, cookie) = await TestHelpers.RegisterAndLoginAsync(client);

        var createResp = await client.PostAsJsonAsync("/api/v1/projects", new { name = "My Project" });
        createResp.EnsureSuccessStatusCode();
        var project = await createResp.Content.ReadFromJsonAsync<JsonElement>();
        return (client, userId, cookie, project.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task ListMine_only_returns_the_callers_own_projects()
    {
        var (client, _, cookie, projectId) = await SetupOwnedProjectAsync();

        var response = await client.SendAsync(WithCookie(HttpMethod.Get, "/api/v1/projects", cookie));
        response.EnsureSuccessStatusCode();
        var projects = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids = projects.EnumerateArray().Select(p => p.GetProperty("id").GetGuid()).ToList();

        Assert.Contains(projectId, ids);
    }

    [Fact]
    public async Task Rename_changes_the_name()
    {
        var (client, _, cookie, projectId) = await SetupOwnedProjectAsync();

        var response = await client.SendAsync(new HttpRequestMessage(HttpMethod.Put, $"/api/v1/projects/{projectId}")
        {
            Headers = { { "Cookie", cookie } },
            Content = JsonContent.Create(new { name = "Renamed" }),
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Renamed", body.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Another_users_cookie_cannot_rename_or_delete_someone_elses_project()
    {
        var (client, _, _, projectId) = await SetupOwnedProjectAsync();
        var (_, otherCookie) = await TestHelpers.RegisterAndLoginAsync(client);

        var renameResponse = await client.SendAsync(new HttpRequestMessage(HttpMethod.Put, $"/api/v1/projects/{projectId}")
        {
            Headers = { { "Cookie", otherCookie } },
            Content = JsonContent.Create(new { name = "Hijacked" }),
        });
        Assert.Equal(HttpStatusCode.Forbidden, renameResponse.StatusCode);

        var deleteResponse = await client.SendAsync(WithCookie(HttpMethod.Delete, $"/api/v1/projects/{projectId}", otherCookie));
        Assert.Equal(HttpStatusCode.Forbidden, deleteResponse.StatusCode);
    }

    [Fact]
    public async Task Delete_then_get_returns_404()
    {
        var (client, _, cookie, projectId) = await SetupOwnedProjectAsync();

        var deleteResponse = await client.SendAsync(WithCookie(HttpMethod.Delete, $"/api/v1/projects/{projectId}", cookie));
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getResponse = await client.GetAsync($"/api/v1/projects/{projectId}");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    [Fact]
    public async Task Management_endpoints_require_a_dashboard_session_not_just_any_request()
    {
        var (_, _, _, projectId) = await SetupOwnedProjectAsync();

        // A genuinely fresh, never-logged-in client — the setup helper's own client auto-persists
        // its login cookie (WebApplicationFactory's CreateClient() has cookie handling on by
        // default), so reusing it here would still be authenticated and prove nothing.
        var anonymousClient = factory.CreateClient();
        var response = await anonymousClient.PutAsJsonAsync($"/api/v1/projects/{projectId}", new { name = "No Cookie" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anonymous_callers_cannot_create_projects_read_them_or_mint_keys()
    {
        var (_, _, _, projectId) = await SetupOwnedProjectAsync();
        var anonymousClient = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymousClient.PostAsJsonAsync("/api/v1/projects", new { name = "Squat" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymousClient.GetAsync($"/api/v1/projects/{projectId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymousClient.PostAsJsonAsync($"/api/v1/projects/{projectId}/api-keys", new { name = "stolen" })).StatusCode);
    }

    [Fact]
    public async Task Another_signed_in_user_cannot_read_a_project_or_mint_keys_for_it()
    {
        var (_, _, _, projectId) = await SetupOwnedProjectAsync();
        var strangerClient = factory.CreateClient();
        var (_, strangerCookie) = await TestHelpers.RegisterAndLoginAsync(strangerClient);

        var read = await strangerClient.SendAsync(WithCookie(HttpMethod.Get, $"/api/v1/projects/{projectId}", strangerCookie));
        Assert.Equal(HttpStatusCode.Forbidden, read.StatusCode);

        var mint = WithCookie(HttpMethod.Post, $"/api/v1/projects/{projectId}/api-keys", strangerCookie);
        mint.Content = JsonContent.Create(new { name = "stolen" });
        Assert.Equal(HttpStatusCode.Forbidden, (await strangerClient.SendAsync(mint)).StatusCode);
    }

    [Fact]
    public async Task A_new_project_always_belongs_to_the_signed_in_caller()
    {
        var client = factory.CreateClient();
        var (userId, _) = await TestHelpers.RegisterAndLoginAsync(client);

        // A body-supplied owner id is ignored — there is no way to create a project in someone else's account.
        var response = await client.PostAsJsonAsync("/api/v1/projects", new { userId = Guid.NewGuid(), name = "Mine" });
        response.EnsureSuccessStatusCode();
        var project = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(userId, project.GetProperty("userId").GetGuid());
    }

    [Fact]
    public async Task The_passwordless_user_bootstrap_endpoint_no_longer_exists()
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/users", new { email = "victim@avatarforge.test" });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
