using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AvatarForge.IntegrationTests;

/// <summary>Server-side validation is the real contract — clients (web or SDK) can't be trusted to send well-formed configurations.</summary>
public class ConfigurationValidationTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private static JsonObject Config(Action<JsonObject>? mutate = null)
    {
        var node = JsonSerializer.SerializeToNode(TestHelpers.DefaultConfiguration(), TestHelpers.JsonOptions)!.AsObject();
        mutate?.Invoke(node);
        return node;
    }

    private async Task<(HttpStatusCode status, JsonElement body)> CreateAsync(JsonObject configuration)
    {
        var (client, _) = await TestHelpers.SignedInClientAsync(factory);
        var response = await client.PostAsJsonAsync("/api/v1/avatars", new { name = "validation", configuration });
        return (response.StatusCode, await response.Content.ReadFromJsonAsync<JsonElement>());
    }

    [Fact]
    public async Task Every_problem_is_reported_in_one_response()
    {
        var (status, body) = await CreateAsync(Config(c =>
        {
            c["face"]!["skinTone"] = "tan";
            c["face"]!["expression"] = "smirk";
            c["body"]!["height"] = 3;
        }));

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Equal("INVALID_CONFIGURATION", body.GetProperty("error").GetProperty("code").GetString());
        var errors = body.GetProperty("error").GetProperty("details").GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToList();
        Assert.Contains(errors, e => e.Contains("face.skinTone"));
        Assert.Contains(errors, e => e.Contains("face.expression"));
        Assert.Contains(errors, e => e.Contains("body.height"));
    }

    [Fact]
    public async Task An_asset_in_the_wrong_slot_is_rejected()
    {
        var (status, body) = await CreateAsync(Config(c => c["hair"]!["style"] = "shoes_cloth"));
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("hair.style", body.GetProperty("error").GetProperty("message").GetString());
    }

    [Fact]
    public async Task Unknown_assets_are_rejected()
    {
        var (status, _) = await CreateAsync(Config(c => c["clothing"]!["top"] = "top_does_not_exist"));
        Assert.Equal(HttpStatusCode.BadRequest, status);
    }

    [Fact]
    public async Task Only_one_accessory_per_slot()
    {
        var (status, body) = await CreateAsync(Config(c => c["accessories"] = new JsonArray("glasses_optical", "glasses_round")));
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("slot", body.GetProperty("error").GetProperty("message").GetString());
    }

    [Fact]
    public async Task Facial_hair_must_reference_facial_hair_assets()
    {
        var ok = await CreateAsync(Config(c =>
        {
            c["facialHair"]!["beardStyle"] = "beard_short";
            c["facialHair"]!["mustacheStyle"] = "mustache_classic";
        }));
        Assert.Equal(HttpStatusCode.Created, ok.status);

        var swapped = await CreateAsync(Config(c => c["facialHair"]!["beardStyle"] = "mustache_classic"));
        Assert.Equal(HttpStatusCode.BadRequest, swapped.status);
    }

    [Fact]
    public async Task Every_shared_preset_passes_server_validation()
    {
        var presets = JsonDocument.Parse(File.ReadAllText(TestHelpers.SharedPath("avatar-presets.json"))).RootElement.GetProperty("presets");
        var (client, _) = await TestHelpers.SignedInClientAsync(factory);
        foreach (var preset in presets.EnumerateArray())
        {
            var response = await client.PostAsJsonAsync("/api/v1/avatars", new { name = preset.GetProperty("name").GetString(), configuration = preset.GetProperty("configuration") });
            Assert.True(response.StatusCode == HttpStatusCode.Created, $"Preset '{preset.GetProperty("id").GetString()}' was rejected: {await response.Content.ReadAsStringAsync()}");
        }
    }
}
