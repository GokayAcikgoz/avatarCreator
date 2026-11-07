using AvatarForge.Application.Usage;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Infrastructure.Persistence;

public class EfUsageTracker(AvatarForgeDbContext db) : IUsageTracker
{
    public async Task RecordAsync(Guid projectId, Guid apiKeyId, string endpoint, string operation, int statusCode, long durationMs, CancellationToken ct = default)
    {
        db.ApiUsageEvents.Add(new ApiUsageEvent
        {
            ProjectId = projectId,
            ApiKeyId = apiKeyId,
            Endpoint = endpoint,
            Operation = operation,
            StatusCode = statusCode,
            DurationMs = durationMs,
            Timestamp = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync(ct);
    }
}
