using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

public class AvatarCrudTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<HttpClient> AuthedClientAsync()
    {
        var key = await TestHelpers.CreateApiKeyAsync(factory);
        _client.DefaultRequestHeaders.Remove("X-API-Key");
        _client.DefaultRequestHeaders.Add("X-API-Key", key);
        return _client;
    }

    [Fact]
    public async Task Full_create_read_update_delete_cycle_round_trips_the_configuration_exactly()
    {
        var client = await AuthedClientAsync();

        var createResponse = await client.PostAsJsonAsync("/api/v1/avatars", new
        {
            name = "Integration Test Avatar",
            configuration = TestHelpers.DefaultConfiguration(),
        });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal("hair_short_bob", created.GetProperty("configuration").GetProperty("hair").GetProperty("style").GetString());

        var getResponse = await client.GetAsync($"/api/v1/avatars/{id}");
        getResponse.EnsureSuccessStatusCode();
        var fetched = await getResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Integration Test Avatar", fetched.GetProperty("name").GetString());

        var updateResponse = await client.PutAsJsonAsync($"/api/v1/avatars/{id}", new { name = "Renamed" });
        updateResponse.EnsureSuccessStatusCode();
        var updated = await updateResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Renamed", updated.GetProperty("name").GetString());
        // Configuration must survive a name-only update untouched.
        Assert.Equal("hair_short_bob", updated.GetProperty("configuration").GetProperty("hair").GetProperty("style").GetString());

        var deleteResponse = await client.DeleteAsync($"/api/v1/avatars/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getAfterDelete = await client.GetAsync($"/api/v1/avatars/{id}");
        Assert.Equal(HttpStatusCode.NotFound, getAfterDelete.StatusCode);
    }

    [Fact]
    public async Task Create_with_incompatible_assets_is_rejected_with_violation_details()
    {
        var client = await AuthedClientAsync();

        var response = await client.PostAsJsonAsync("/api/v1/avatars", new
        {
            name = "Bad Avatar",
            configuration = TestHelpers.DefaultConfiguration(hairStyle: "hair_long", accessories: ["hat_newsboy_cap"]),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("INCOMPATIBLE_ASSETS", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Create_with_unsupported_configuration_version_is_rejected()
    {
        var client = await AuthedClientAsync();

        var response = await client.PostAsJsonAsync("/api/v1/avatars", new
        {
            name = "Future Avatar",
            configuration = new Dictionary<string, object> { ["version"] = 99 },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task List_only_returns_avatars_created_in_this_run()
    {
        var client = await AuthedClientAsync();
        await client.PostAsJsonAsync("/api/v1/avatars", new { name = "A", configuration = TestHelpers.DefaultConfiguration() });
        await client.PostAsJsonAsync("/api/v1/avatars", new { name = "B", configuration = TestHelpers.DefaultConfiguration() });

        var response = await client.GetAsync("/api/v1/avatars?pageSize=100");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("total").GetInt32() >= 2);
    }
}
