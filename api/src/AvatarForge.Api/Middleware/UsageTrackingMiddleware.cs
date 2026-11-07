using System.Diagnostics;
using AvatarForge.Application.Usage;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Api.Middleware;

/// <summary>Records one ApiUsageEvent per authenticated request (CLAUDE.md section 13). No-ops for unauthenticated requests (no project to attribute usage to).</summary>
public class UsageTrackingMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IUsageTracker usageTracker)
    {
        var sw = Stopwatch.StartNew();
        await next(context);
        sw.Stop();

        if (context.Items.TryGetValue("ApiKey", out var apiKeyObj) && apiKeyObj is ApiKey apiKey)
        {
            var operation = context.GetEndpoint()?.Metadata.GetMetadata<ApiOperationAttribute>()?.Name
                ?? $"{context.Request.Method} {context.Request.Path}";

            await usageTracker.RecordAsync(
                apiKey.ProjectId,
                apiKey.Id,
                context.Request.Path,
                operation,
                context.Response.StatusCode,
                sw.ElapsedMilliseconds
            );
        }
    }
}

/// <summary>Tags a controller action with a stable business-level operation name (CLAUDE.md section 13 examples: "avatar.create", "asset.list").</summary>
[AttributeUsage(AttributeTargets.Method)]
public class ApiOperationAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}
