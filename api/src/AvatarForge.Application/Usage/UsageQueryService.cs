namespace AvatarForge.Application.Usage;

public interface IUsageQueryRepository
{
    Task<UsageSummaryDto> SummarizeAsync(Guid projectId, DateTimeOffset todayStart, DateTimeOffset monthStart, CancellationToken ct = default);
}

public class UsageQueryService(IUsageQueryRepository repository)
{
    public Task<UsageSummaryDto> GetSummaryAsync(Guid projectId, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var todayStart = new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, TimeSpan.Zero);
        var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        return repository.SummarizeAsync(projectId, todayStart, monthStart, ct);
    }
}
