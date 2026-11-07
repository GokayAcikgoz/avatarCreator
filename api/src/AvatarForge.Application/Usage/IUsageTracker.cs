namespace AvatarForge.Application.Usage;

/// <summary>CLAUDE.md section 13 — one row per call (endpoint/operation/status/duration), never the raw payload.</summary>
public interface IUsageTracker
{
    Task RecordAsync(Guid projectId, Guid apiKeyId, string endpoint, string operation, int statusCode, long durationMs, CancellationToken ct = default);
}
