using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

/// <summary>The public reference-data endpoints serve exactly what's in shared/*.json — the same data the web creator ships.</summary>
public class CatalogEndpointTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static JsonElement Shared(string file) => JsonDocument.Parse(File.ReadAllText(TestHelpers.SharedPath(file))).RootElement;

    [Fact]
    public async Task Presets_are_public_and_match_the_shared_file()
    {
        var response = await _client.GetAsync("/api/v1/presets");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("items").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToList();
        var expected = Shared("avatar-presets.json").GetProperty("presets").EnumerateArray().Select(p => p.GetProperty("id").GetString()).ToList();
        Assert.Equal(expected, ids);
    }

    [Fact]
    public async Task Animation_library_lists_every_clip_and_serves_tracks_on_request()
    {
        var expected = Shared("animation-clips.json").GetProperty("clips").EnumerateArray().Select(c => c.GetProperty("id").GetString()).ToList();
        Assert.Contains("wave", expected);
        Assert.Contains("sit", expected);

        var list = await (await _client.GetAsync("/api/v1/animations")).Content.ReadFromJsonAsync<JsonElement>();
        var items = list.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(expected, items.Select(i => i.GetProperty("id").GetString()).ToList());
        Assert.Equal(JsonValueKind.Null, items[0].GetProperty("tracks").ValueKind);

        var withTracks = await (await _client.GetAsync("/api/v1/animations?include=tracks")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(withTracks.GetProperty("items")[0].GetProperty("tracks").EnumerateObject().Any());

        var single = await _client.GetAsync("/api/v1/animations/wave");
        Assert.Equal(HttpStatusCode.OK, single.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/v1/animations/moonwalk")).StatusCode);
    }

    [Fact]
    public async Task Expressions_and_editor_catalog_are_public()
    {
        var expressions = await (await _client.GetAsync("/api/v1/expressions")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(expressions.GetProperty("items").EnumerateArray(), e => e.GetProperty("id").GetString() == "smile");

        var catalog = await (await _client.GetAsync("/api/v1/catalog")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(catalog.GetProperty("categories").GetArrayLength() > 5);
        Assert.True(catalog.GetProperty("palettes").TryGetProperty("hair", out _));
    }
}
