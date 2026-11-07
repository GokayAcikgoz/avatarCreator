namespace AvatarForge.Application.Storage;

/// <summary>
/// CLAUDE.md section 24 — local filesystem adapter for dev, S3-compatible adapter for
/// production, same interface either way. Nothing in the Application layer should ever touch
/// a filesystem path or an S3 SDK type directly.
/// </summary>
public interface IObjectStorage
{
    Task<string> SaveAsync(string relativePath, Stream content, string contentType, CancellationToken ct = default);
    Task<Stream?> ReadAsync(string relativePath, CancellationToken ct = default);
    Task DeleteAsync(string relativePath, CancellationToken ct = default);
    string GetPublicUrl(string relativePath);
    /// <summary>Inverse of GetPublicUrl — null when the URL wasn't produced by this storage (never trust a stored URL as a filesystem path).</summary>
    string? ToRelativePath(string publicUrl);
}
