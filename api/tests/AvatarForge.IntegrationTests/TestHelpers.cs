using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace AvatarForge.IntegrationTests;

public static class TestHelpers
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Bootstraps a real user → project → API key chain through the actual endpoints (not seeded directly into the DB) so the auth path itself is exercised by every test that uses it.</summary>
    public static async Task<string> CreateApiKeyAsync(WebApplicationFactory<Program> factory) =>
        (await CreateProjectWithApiKeyAsync(factory)).apiKey;

    /// <summary>
    /// Same chain as CreateApiKeyAsync, but returns the ids too — needed by tests that check ownership.
    /// Runs on its own throwaway client: a signed-in owner creates the project and key, and that
    /// session cookie must never ride along on the caller's API-key requests (it would mask whether
    /// the key itself was accepted).
    /// </summary>
    public static async Task<(Guid userId, Guid projectId, string apiKey)> CreateProjectWithApiKeyAsync(WebApplicationFactory<Program> factory, int? rateLimitPerMinute = null)
    {
        using var dashboard = factory.CreateClient();
        var (userId, _) = await RegisterAndLoginAsync(dashboard);

        var projectResp = await dashboard.PostAsJsonAsync("/api/v1/projects", new { name = "Test Project" });
        projectResp.EnsureSuccessStatusCode();
        var project = await projectResp.Content.ReadFromJsonAsync<JsonElement>();
        var projectId = project.GetProperty("id").GetGuid();

        var keyResp = await dashboard.PostAsJsonAsync($"/api/v1/projects/{projectId}/api-keys", new { name = "test key", rateLimitPerMinute });
        keyResp.EnsureSuccessStatusCode();
        var keyJson = await keyResp.Content.ReadFromJsonAsync<JsonElement>();
        return (userId, projectId, keyJson.GetProperty("key").GetString()!);
    }

    /// <summary>Registers a fresh dashboard user, logs in, and returns the raw Cookie header value to replay on subsequent requests (WebApplicationFactory's HttpClient doesn't auto-forward cookies between calls).</summary>
    public static async Task<(Guid userId, string cookie)> RegisterAndLoginAsync(HttpClient client)
    {
        var email = $"dash-test-{Guid.NewGuid():N}@avatarforge.test";
        const string password = "correcthorsebattery";

        var registerResp = await client.PostAsJsonAsync("/api/v1/auth/register", new { email, password });
        registerResp.EnsureSuccessStatusCode();
        var user = await registerResp.Content.ReadFromJsonAsync<JsonElement>();
        var userId = user.GetProperty("id").GetGuid();

        var loginResp = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        loginResp.EnsureSuccessStatusCode();
        var cookie = loginResp.Headers.TryGetValues("Set-Cookie", out var cookies)
            ? cookies.First().Split(';')[0]
            : throw new InvalidOperationException("Login did not set a session cookie.");

        return (userId, cookie);
    }

    /// <summary>Walks up from the test binaries to the repo's shared/ folder (the catalog's single source of truth).</summary>
    public static string SharedPath(string fileName)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "shared", fileName))) dir = dir.Parent;
        return dir is null
            ? throw new FileNotFoundException($"shared/{fileName} not found above {AppContext.BaseDirectory}")
            : Path.Combine(dir.FullName, "shared", fileName);
    }

    public static List<JsonElement> SharedCatalogAssets() =>
        JsonDocument.Parse(File.ReadAllText(SharedPath("asset-catalog.json"))).RootElement.GetProperty("assets").EnumerateArray().ToList();

    /// <summary>A client whose cookie jar holds a fresh, signed-in web-creator session (WebApplicationFactory clients keep cookies between calls).</summary>
    public static async Task<(HttpClient client, Guid userId)> SignedInClientAsync(CustomWebApplicationFactory factory)
    {
        var client = factory.CreateClient();
        var email = $"creator-{Guid.NewGuid():N}@avatarforge.test";
        const string password = "correcthorsebattery";
        var registerResp = await client.PostAsJsonAsync("/api/v1/auth/register", new { email, password });
        registerResp.EnsureSuccessStatusCode();
        var user = await registerResp.Content.ReadFromJsonAsync<JsonElement>();
        var loginResp = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        loginResp.EnsureSuccessStatusCode();
        return (client, user.GetProperty("id").GetGuid());
    }

    /// <summary>Smallest valid PNG (1x1, RGBA) — real signature + chunks, for thumbnail upload tests.</summary>
    public static byte[] TinyPng() => Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    public static object DefaultConfiguration(string? hairStyle = "hair_short_bob", string[]? accessories = null) => new
    {
        version = 1,
        body = new { type = "unisex", height = 0.5, shoulderWidth = 0.5, proportion = 0.5 },
        face = new
        {
            shape = "oval", skinTone = "#C68863", eyeShape = "almond", eyeColor = "#3B2415",
            eyebrows = "natural", nose = "straight", mouth = "neutral", earShape = "standard",
            morphs = new Dictionary<string, double>(), expression = "neutral",
        },
        hair = new { style = hairStyle, color = "#3B2415" },
        facialHair = new { beardStyle = (string?)null, mustacheStyle = (string?)null, color = "#24160E" },
        clothing = new
        {
            top = "top_tshirt", topColor = "#111111",
            bottom = "bottom_wool_pants", bottomColor = "#495057",
            shoes = "shoes_cloth", shoesColor = "#F5F5F5",
        },
        accessories = accessories ?? [],
        accessoryColors = new Dictionary<string, string>(),
    };
}
