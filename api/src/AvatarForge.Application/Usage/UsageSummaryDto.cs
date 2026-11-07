namespace AvatarForge.Application.Usage;

/// <summary>CLAUDE.md Phase 8 §17 — real aggregates from ApiUsageEvent, never mock data.</summary>
public class UsageSummaryDto
{
    public int RequestsToday { get; set; }
    public int RequestsThisMonth { get; set; }
    public int SuccessfulRequests { get; set; }
    public int FailedRequests { get; set; }
    public int RenderCount { get; set; }
    public int ExportCount { get; set; }
    public List<RecentRequestDto> RecentRequests { get; set; } = [];
}

public class RecentRequestDto
{
    public string Endpoint { get; set; } = string.Empty;
    public string Operation { get; set; } = string.Empty;
    public int StatusCode { get; set; }
    public long DurationMs { get; set; }
    public DateTimeOffset Timestamp { get; set; }
}
