using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

/// <summary>
/// Phase 8 replaces Phase 7's NotImplementedAvatarRenderer with a real Blender-backed
/// implementation — these tests now assert genuine success (a downloadable file), not the old
/// 501. Slow (each case shells out to a real Blender process) by nature of testing the real thing
/// rather than mocking it, matching this project's "gerçek çalışan sistem" testing standard.
/// </summary>
[Collection(BlenderCollection.Name)]
public class RenderExportTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<(HttpClient client, Guid avatarId)> AuthedClientWithAvatarAsync()
    {
        var key = await TestHelpers.CreateApiKeyAsync(factory);
        _client.DefaultRequestHeaders.Remove("X-API-Key");
        _client.DefaultRequestHeaders.Add("X-API-Key", key);

        var createResponse = await _client.PostAsJsonAsync("/api/v1/avatars", new
        {
            name = "Render Test Avatar",
            configuration = TestHelpers.DefaultConfiguration(),
        });
        createResponse.EnsureSuccessStatusCode();
        var created = await createResponse.Content.ReadFromJsonAsync<JsonElement>();
        return (_client, created.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Render_produces_a_real_downloadable_png()
    {
        var (client, avatarId) = await AuthedClientWithAvatarAsync();
        var response = await client.PostAsJsonAsync($"/api/v1/avatars/{avatarId}/render", new { format = "png", width = 256, height = 256, transparent = true });
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("completed", body.GetProperty("status").GetString());
        var url = body.GetProperty("url").GetString()!;

        var download = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        var bytes = await download.Content.ReadAsByteArrayAsync();
        Assert.True(bytes.Length > 1000, "Rendered PNG should be a real, non-trivial file.");
        // PNG magic bytes
        Assert.Equal(0x89, bytes[0]);
        Assert.Equal((byte)'P', bytes[1]);
        Assert.Equal((byte)'N', bytes[2]);
        Assert.Equal((byte)'G', bytes[3]);
    }

    [Fact]
    public async Task Render_rejects_absurd_dimensions()
    {
        var (client, avatarId) = await AuthedClientWithAvatarAsync();
        var response = await client.PostAsJsonAsync($"/api/v1/avatars/{avatarId}/render", new { format = "png", width = 50000, height = 50000, transparent = true });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("VALIDATION_FAILED", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Export_produces_a_real_downloadable_glb()
    {
        var (client, avatarId) = await AuthedClientWithAvatarAsync();
        var response = await client.PostAsJsonAsync($"/api/v1/avatars/{avatarId}/export", new { format = "glb" });
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var url = body.GetProperty("url").GetString()!;

        var download = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        var bytes = await download.Content.ReadAsByteArrayAsync();
        Assert.True(bytes.Length > 10000, "Exported GLB should be a real, non-trivial file.");
        // glTF binary magic ("glTF")
        Assert.Equal((byte)'g', bytes[0]);
        Assert.Equal((byte)'l', bytes[1]);
        Assert.Equal((byte)'T', bytes[2]);
        Assert.Equal((byte)'F', bytes[3]);
    }
    [Fact]
    public async Task Render_accepts_an_animation_pose_camera_and_background()
    {
        var (client, avatarId) = await AuthedClientWithAvatarAsync();
        var response = await client.PostAsJsonAsync("/api/v1/avatars/render", new
        {
            avatarId,
            format = "png",
            width = 256,
            height = 256,
            animation = "wave",
            time = 0.4,
            camera = "portrait",
            background = "#1B1F2A",
        });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var bytes = await (await client.GetAsync(body.GetProperty("url").GetString())).Content.ReadAsByteArrayAsync();
        Assert.Equal(0x89, bytes[0]);
        // Opaque background requested → PNG color type 2 (RGB), not 6 (RGBA).
        Assert.Equal(2, bytes[25]);
    }

    [Fact]
    public async Task Render_rejects_unknown_animation_and_camera_without_starting_blender()
    {
        var (client, avatarId) = await AuthedClientWithAvatarAsync();
        var badAnimation = await client.PostAsJsonAsync($"/api/v1/avatars/{avatarId}/render", new { format = "png", width = 256, height = 256, animation = "moonwalk" });
        Assert.Equal(HttpStatusCode.BadRequest, badAnimation.StatusCode);
        var badCamera = await client.PostAsJsonAsync($"/api/v1/avatars/{avatarId}/render", new { format = "png", width = 256, height = 256, camera = "drone" });
        Assert.Equal(HttpStatusCode.BadRequest, badCamera.StatusCode);
        var badBackground = await client.PostAsJsonAsync($"/api/v1/avatars/{avatarId}/render", new { format = "png", width = 256, height = 256, background = "red; rm -rf /" });
        Assert.Equal(HttpStatusCode.BadRequest, badBackground.StatusCode);
    }

    [Fact]
    public async Task Export_embeds_one_skeleton_and_every_animation_clip()
    {
        var (client, avatarId) = await AuthedClientWithAvatarAsync();
        var response = await client.PostAsJsonAsync($"/api/v1/avatars/{avatarId}/export", new { format = "glb", includeAnimations = true });
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var bytes = await (await client.GetAsync(body.GetProperty("url").GetString())).Content.ReadAsByteArrayAsync();

        // GLB: 12-byte header, then the JSON chunk (length, type, payload).
        var jsonLength = BitConverter.ToInt32(bytes, 12);
        var gltf = JsonDocument.Parse(System.Text.Encoding.UTF8.GetString(bytes, 20, jsonLength)).RootElement;
        Assert.Equal(1, gltf.GetProperty("skins").GetArrayLength());
        var expectedClips = JsonDocument.Parse(File.ReadAllText(TestHelpers.SharedPath("animation-clips.json"))).RootElement.GetProperty("clips").GetArrayLength();
        Assert.Equal(expectedClips, gltf.GetProperty("animations").GetArrayLength());
    }
}
