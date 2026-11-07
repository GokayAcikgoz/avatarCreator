using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

public class AssetCatalogTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
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
    public async Task List_returns_the_real_seeded_manifest()
    {
        var client = await AuthedClientAsync();
        var response = await client.GetAsync("/api/v1/assets?pageSize=100");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var total = body.GetProperty("total").GetInt32();

        // Exactly the entries of shared/asset-catalog.json — the file the web creator imports too.
        Assert.Equal(TestHelpers.SharedCatalogAssets().Count, total);
    }

    [Fact]
    public async Task Filtering_by_category_narrows_results()
    {
        var client = await AuthedClientAsync();
        var response = await client.GetAsync("/api/v1/assets?category=hair&pageSize=100");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        Assert.Equal(TestHelpers.SharedCatalogAssets().Count(a => a.GetProperty("category").GetString() == "hair"), items.Count);
        Assert.All(items, item => Assert.Equal("hair", item.GetProperty("category").GetString()));
    }

    [Fact]
    public async Task Get_by_id_returns_known_asset_with_correct_compatibility_data()
    {
        var client = await AuthedClientAsync();
        var response = await client.GetAsync("/api/v1/assets/hair_long");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("hair_long", body.GetProperty("id").GetString());
        var incompatible = body.GetProperty("incompatibleWith").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains("hat_newsboy_cap", incompatible);
    }

    [Fact]
    public async Task Get_unknown_asset_returns_404_with_standard_error_envelope()
    {
        var client = await AuthedClientAsync();
        var response = await client.GetAsync("/api/v1/assets/does_not_exist");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ASSET_NOT_FOUND", body.GetProperty("error").GetProperty("code").GetString());
    }
}
