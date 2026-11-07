namespace AvatarForge.Domain.Entities;

/// <summary>
/// One row per API call, not per raw payload (CLAUDE.md section 13 explicitly rejects logging
/// full payloads). <see cref="Operation"/> is a stable business-level tag (e.g. "avatar.create",
/// "asset.list", "render.png") distinct from the raw route, so usage dashboards and billing
/// later don't need to parse URLs.
/// </summary>
public class ApiUsageEvent
{
    public long Id { get; set; }
    public Guid ProjectId { get; set; }
    public Guid ApiKeyId { get; set; }

    public string Endpoint { get; set; } = string.Empty;
    public string Operation { get; set; } = string.Empty;
    public int StatusCode { get; set; }
    public long DurationMs { get; set; }

    public DateTimeOffset Timestamp { get; set; }
}
