using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

/// <summary>
/// The browser flow: a person signed into the web creator (cookie session, no API key) creates,
/// lists, updates, thumbnails and deletes their own avatars — and nobody else can touch them.
/// </summary>
public class WebCreatorAvatarTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private static async Task<JsonElement> CreateAsync(HttpClient client, string name = "My Avatar", object? configuration = null)
    {
        var response = await client.PostAsJsonAsync("/api/v1/avatars", new { name, configuration = configuration ?? TestHelpers.DefaultConfiguration() });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Signed_in_user_creates_an_avatar_owned_by_their_account()
    {
        var (client, _) = await TestHelpers.SignedInClientAsync(factory);
        var created = await CreateAsync(client, "Browser Avatar");

        Assert.Equal("Browser Avatar", created.GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, created.GetProperty("ownerProjectId").ValueKind);
        Assert.False(created.TryGetProperty("ownerUserId", out _), "The owning account id is internal and must not be serialized.");

        var fetched = await client.GetAsync($"/api/v1/avatars/{created.GetProperty("id").GetGuid()}");
        Assert.Equal(HttpStatusCode.OK, fetched.StatusCode);
    }

    [Fact]
    public async Task Anonymous_create_is_rejected()
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/avatars", new { name = "x", configuration = TestHelpers.DefaultConfiguration() });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task My_avatars_list_only_contains_the_callers_avatars()
    {
        var (alice, _) = await TestHelpers.SignedInClientAsync(factory);
        var (bob, _) = await TestHelpers.SignedInClientAsync(factory);
        var aliceAvatar = await CreateAsync(alice, "Alice's");
        await CreateAsync(bob, "Bob's");

        var list = await (await alice.GetAsync("/api/v1/avatars?pageSize=100")).Content.ReadFromJsonAsync<JsonElement>();
        var ids = list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToList();

        Assert.Single(ids);
        Assert.Equal(aliceAvatar.GetProperty("id").GetGuid(), ids[0]);
        Assert.Equal(1, list.GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Other_accounts_and_api_keys_cannot_read_update_or_delete()
    {
        var (owner, _) = await TestHelpers.SignedInClientAsync(factory);
        var (stranger, _) = await TestHelpers.SignedInClientAsync(factory);
        var id = (await CreateAsync(owner)).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync($"/api/v1/avatars/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.PutAsJsonAsync($"/api/v1/avatars/{id}", new { name = "hijacked" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.DeleteAsync($"/api/v1/avatars/{id}")).StatusCode);

        var keyClient = factory.CreateClient();
        var key = await TestHelpers.CreateApiKeyAsync(factory);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/avatars/{id}");
        request.Headers.Add("X-API-Key", key);
        Assert.Equal(HttpStatusCode.Forbidden, (await keyClient.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Owner_can_update_rename_publish_and_delete()
    {
        var (client, _) = await TestHelpers.SignedInClientAsync(factory);
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        var update = await client.PutAsJsonAsync($"/api/v1/avatars/{id}", new
        {
            name = "Renamed",
            visibility = "Public",
            configuration = TestHelpers.DefaultConfiguration(hairStyle: "hair_bun"),
        });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = await update.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Renamed", updated.GetProperty("name").GetString());
        Assert.Equal("Public", updated.GetProperty("visibility").GetString());
        Assert.Equal("hair_bun", updated.GetProperty("configuration").GetProperty("hair").GetProperty("style").GetString());

        // Public → readable anonymously, still without owner info.
        var anonymous = factory.CreateClient();
        var pub = await anonymous.GetAsync($"/api/v1/avatars/public/{id}");
        Assert.Equal(HttpStatusCode.OK, pub.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/v1/avatars/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/avatars/{id}")).StatusCode);
    }

    [Fact]
    public async Task Configuration_endpoints_read_and_replace_just_the_configuration()
    {
        var (client, _) = await TestHelpers.SignedInClientAsync(factory);
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        var config = await (await client.GetAsync($"/api/v1/avatars/{id}/configuration")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, config.GetProperty("version").GetInt32());
        Assert.Equal("hair_short_bob", config.GetProperty("hair").GetProperty("style").GetString());

        var put = await client.PutAsJsonAsync($"/api/v1/avatars/{id}/configuration", TestHelpers.DefaultConfiguration(hairStyle: "hair_crop"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var after = await (await client.GetAsync($"/api/v1/avatars/{id}/configuration")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("hair_crop", after.GetProperty("hair").GetProperty("style").GetString());
    }

    [Fact]
    public async Task Thumbnail_upload_stores_a_real_image_and_replaces_the_old_one()
    {
        var (client, _) = await TestHelpers.SignedInClientAsync(factory);
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        async Task<string> UploadAsync()
        {
            using var content = new ByteArrayContent(TestHelpers.TinyPng());
            content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            var response = await client.PutAsync($"/api/v1/avatars/{id}/thumbnail", content);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("thumbnailUrl").GetString()!;
        }

        var first = await UploadAsync();
        var download = await client.GetAsync(first);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal(TestHelpers.TinyPng(), await download.Content.ReadAsByteArrayAsync());

        var second = await UploadAsync();
        Assert.NotEqual(first, second);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(first)).StatusCode);
    }

    [Fact]
    public async Task Thumbnail_upload_rejects_non_images_even_with_an_image_content_type()
    {
        var (client, _) = await TestHelpers.SignedInClientAsync(factory);
        var id = (await CreateAsync(client)).GetProperty("id").GetGuid();

        using var content = new ByteArrayContent("<svg onload=alert(1)>"u8.ToArray());
        content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        var response = await client.PutAsync($"/api/v1/avatars/{id}/thumbnail", content);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }
}
