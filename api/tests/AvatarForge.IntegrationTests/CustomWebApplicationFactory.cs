using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace AvatarForge.IntegrationTests;

/// <summary>
/// Runs the real app (real migrations, real AssetSeeder, real middleware pipeline) against a
/// dedicated `avatarforge_test` Postgres database — not mocks, not an in-memory provider, per
/// the "gerçek çalışan sistem" standard this whole project has followed. Tests use unique emails
/// per run so re-running the suite never collides on the Users.Email unique index.
/// The connection string comes from the AVATARFORGE_TEST_DB_CONNECTION environment variable
/// (set it in the git-ignored repo-root .env; `npm run test:api` loads it) — never from code.
/// </summary>
public class CustomWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string ConnectionVariable = "AVATARFORGE_TEST_DB_CONNECTION";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        var connectionString = Environment.GetEnvironmentVariable(ConnectionVariable);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                $"{ConnectionVariable} is not set. Copy .env.example to .env, fill in the test database connection string and run `npm run test:api`.");
        }

        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = connectionString,
                // The suite registers hundreds of users from one test "address"; RateLimitTests
                // checks the real ceiling on a host of its own.
                ["RateLimiting:AuthAttemptsPerMinute"] = "100000",
            });
        });
    }
}
