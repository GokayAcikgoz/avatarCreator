using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace AvatarForge.IntegrationTests;

public class DashboardAuthTests(CustomWebApplicationFactory factory) : IClassFixture<CustomWebApplicationFactory>
{
    private static (string email, string password) NewCredentials() =>
        ($"auth-test-{Guid.NewGuid():N}@avatarforge.test", "correcthorsebattery");

    [Fact]
    public async Task Register_then_login_then_me_round_trips_the_same_user()
    {
        var client = factory.CreateClient();
        var (email, password) = NewCredentials();

        var registerResponse = await client.PostAsJsonAsync("/api/v1/auth/register", new { email, password });
        registerResponse.EnsureSuccessStatusCode();

        var loginResponse = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        loginResponse.EnsureSuccessStatusCode();

        var meResponse = await client.GetAsync("/api/v1/auth/me");
        meResponse.EnsureSuccessStatusCode();
        var me = await meResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(email, me.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Me_without_a_session_is_unauthorized()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_with_wrong_password_is_unauthorized()
    {
        var client = factory.CreateClient();
        var (email, password) = NewCredentials();
        await client.PostAsJsonAsync("/api/v1/auth/register", new { email, password });

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "not-the-password" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Registering_the_same_email_twice_is_rejected()
    {
        var client = factory.CreateClient();
        var (email, password) = NewCredentials();
        await client.PostAsJsonAsync("/api/v1/auth/register", new { email, password });

        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new { email, password });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Short_password_is_rejected()
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new { email = $"short-{Guid.NewGuid():N}@avatarforge.test", password = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Logout_actually_ends_the_session()
    {
        var (email, password) = NewCredentials();

        // WebApplicationFactory's CreateClient() doesn't auto-forward Set-Cookie between calls,
        // so the cookie is captured from the login response and replayed manually on later requests.
        var factoryClient = factory.CreateClient();
        await factoryClient.PostAsJsonAsync("/api/v1/auth/register", new { email, password });
        var loginResponse = await factoryClient.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        var setCookie = loginResponse.Headers.TryGetValues("Set-Cookie", out var cookies) ? cookies.First() : null;
        Assert.NotNull(setCookie);
        var cookieValue = setCookie.Split(';')[0];

        using var meBefore = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/me");
        meBefore.Headers.Add("Cookie", cookieValue);
        Assert.Equal(HttpStatusCode.OK, (await factoryClient.SendAsync(meBefore)).StatusCode);

        using var logout = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/logout");
        logout.Headers.Add("Cookie", cookieValue);
        var logoutResponse = await factoryClient.SendAsync(logout);
        var expiredCookie = logoutResponse.Headers.TryGetValues("Set-Cookie", out var expired) ? expired.First() : null;
        Assert.NotNull(expiredCookie);
        Assert.Contains("1970", expiredCookie);
    }
}
