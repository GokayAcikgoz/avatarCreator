using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.Json;
using AvatarForge.Application.Common;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Api.Middleware;

/// <summary>
/// Fixed-window (60 s) rate limiting, in memory — the explicitly sanctioned MVP choice (a Redis
/// store is the drop-in upgrade for multi-instance deployments):
/// <list type="bullet">
/// <item>API keys: the limit stored on the key itself (RateLimitPerMinute).</item>
/// <item>Signed-in web/dashboard sessions: <c>RateLimiting:SessionRequestsPerMinute</c> per account
/// (default 240) — sessions can trigger server renders too, so they need a ceiling as well.</item>
/// <item>Anonymous sign-in / registration attempts: <c>RateLimiting:AuthAttemptsPerMinute</c> per
/// client IP (default 10) — slows password guessing and account-creation floods. Behind a reverse
/// proxy, enable forwarded headers so the real client IP is used.</item>
/// </list>
/// </summary>
public class RateLimitingMiddleware(RequestDelegate next, IConfiguration configuration)
{
    private static readonly ConcurrentDictionary<string, Window> Windows = new();
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan WindowSize = TimeSpan.FromMinutes(1);

    private readonly int _sessionLimit = configuration.GetValue("RateLimiting:SessionRequestsPerMinute", 240);
    private readonly int _authAttemptLimit = configuration.GetValue("RateLimiting:AuthAttemptsPerMinute", 10);

    private static bool IsAuthAttempt(HttpRequest request) =>
        HttpMethods.IsPost(request.Method)
        && (request.Path.StartsWithSegments("/api/v1/auth/login", StringComparison.OrdinalIgnoreCase)
            || request.Path.StartsWithSegments("/api/v1/auth/register", StringComparison.OrdinalIgnoreCase));

    private class Window
    {
        public DateTimeOffset StartedAt;
        public int Count;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        string? bucket = null;
        var limit = 0;
        string? subject = null;

        if (context.Items.TryGetValue("ApiKey", out var apiKeyObj) && apiKeyObj is ApiKey apiKey)
        {
            bucket = $"key:{apiKey.Id}";
            limit = apiKey.RateLimitPerMinute;
            subject = "this API key";
        }
        else if (context.User.Identity?.IsAuthenticated == true && context.User.FindFirstValue(ClaimTypes.NameIdentifier) is { } userId)
        {
            bucket = $"user:{userId}";
            limit = _sessionLimit;
            subject = "this account";
        }
        else if (IsAuthAttempt(context.Request))
        {
            bucket = $"auth:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
            limit = _authAttemptLimit;
            subject = "sign-in attempts from this address";
        }

        if (bucket is not null)
        {
            var window = Windows.GetOrAdd(bucket, _ => new Window { StartedAt = DateTimeOffset.UtcNow, Count = 0 });
            int count;
            DateTimeOffset startedAt;
            lock (window)
            {
                if (DateTimeOffset.UtcNow - window.StartedAt >= WindowSize)
                {
                    window.StartedAt = DateTimeOffset.UtcNow;
                    window.Count = 0;
                }
                count = ++window.Count;
                startedAt = window.StartedAt;
            }

            context.Response.Headers["X-RateLimit-Limit"] = limit.ToString();
            context.Response.Headers["X-RateLimit-Remaining"] = Math.Max(0, limit - count).ToString();

            if (count > limit)
            {
                var retryAfter = Math.Max(1, (int)Math.Ceiling((startedAt + WindowSize - DateTimeOffset.UtcNow).TotalSeconds));
                context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                context.Response.Headers.RetryAfter = retryAfter.ToString();
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(JsonSerializer.Serialize(new ApiErrorResponse
                {
                    Error = new ApiErrorBody
                    {
                        Code = ErrorCodes.RateLimited,
                        Message = $"Rate limit of {limit} requests/minute exceeded for {subject}. Retry in {retryAfter}s.",
                    },
                }, JsonOptions));
                return;
            }
        }

        await next(context);
    }
}
