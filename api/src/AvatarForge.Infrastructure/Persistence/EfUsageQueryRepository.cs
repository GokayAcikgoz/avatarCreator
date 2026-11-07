using AvatarForge.Application.Usage;
using Microsoft.EntityFrameworkCore;

namespace AvatarForge.Infrastructure.Persistence;

public class EfUsageQueryRepository(AvatarForgeDbContext db) : IUsageQueryRepository
{
    public async Task<UsageSummaryDto> SummarizeAsync(Guid projectId, DateTimeOffset todayStart, DateTimeOffset monthStart, CancellationToken ct = default)
    {
        var events = db.ApiUsageEvents.Where(e => e.ProjectId == projectId);

        return new UsageSummaryDto
        {
            RequestsToday = await events.CountAsync(e => e.Timestamp >= todayStart, ct),
            RequestsThisMonth = await events.CountAsync(e => e.Timestamp >= monthStart, ct),
            SuccessfulRequests = await events.CountAsync(e => e.StatusCode >= 200 && e.StatusCode < 400, ct),
            FailedRequests = await events.CountAsync(e => e.StatusCode >= 400, ct),
            RenderCount = await events.CountAsync(e => e.Operation == "render.png" && e.StatusCode < 400, ct),
            ExportCount = await events.CountAsync(e => e.Operation == "export.glb" && e.StatusCode < 400, ct),
            RecentRequests = await events
                .OrderByDescending(e => e.Timestamp)
                .Take(20)
                .Select(e => new RecentRequestDto
                {
                    Endpoint = e.Endpoint,
                    Operation = e.Operation,
                    StatusCode = e.StatusCode,
                    DurationMs = e.DurationMs,
                    Timestamp = e.Timestamp,
                })
                .ToListAsync(ct),
        };
    }
}
