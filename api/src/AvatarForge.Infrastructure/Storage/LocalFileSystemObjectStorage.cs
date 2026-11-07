using AvatarForge.Application.Storage;
using Microsoft.Extensions.Options;

namespace AvatarForge.Infrastructure.Storage;

public class LocalStorageOptions
{
    public string RootPath { get; set; } = "storage";
    public string PublicBaseUrl { get; set; } = "/storage";
}

/// <summary>Dev-only adapter behind IObjectStorage (CLAUDE.md section 24). Swapping to an S3-compatible adapter later means writing one more class, not touching any caller.</summary>
public class LocalFileSystemObjectStorage(IOptions<LocalStorageOptions> options) : IObjectStorage
{
    private readonly LocalStorageOptions _options = options.Value;

    public async Task<string> SaveAsync(string relativePath, Stream content, string contentType, CancellationToken ct = default)
    {
        var fullPath = ResolvePath(relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await using var fileStream = File.Create(fullPath);
        await content.CopyToAsync(fileStream, ct);
        return GetPublicUrl(relativePath);
    }

    public Task<Stream?> ReadAsync(string relativePath, CancellationToken ct = default)
    {
        var fullPath = ResolvePath(relativePath);
        Stream? stream = File.Exists(fullPath) ? File.OpenRead(fullPath) : null;
        return Task.FromResult(stream);
    }

    public Task DeleteAsync(string relativePath, CancellationToken ct = default)
    {
        var fullPath = ResolvePath(relativePath);
        if (File.Exists(fullPath)) File.Delete(fullPath);
        return Task.CompletedTask;
    }

    public string GetPublicUrl(string relativePath) => $"{_options.PublicBaseUrl.TrimEnd('/')}/{relativePath.TrimStart('/')}";

    public string? ToRelativePath(string publicUrl)
    {
        var prefix = _options.PublicBaseUrl.TrimEnd('/') + "/";
        if (!publicUrl.StartsWith(prefix, StringComparison.Ordinal)) return null;
        var relative = publicUrl[prefix.Length..];
        return relative.Contains("..", StringComparison.Ordinal) ? null : relative;
    }

    private string ResolvePath(string relativePath)
    {
        // Every relative path is server-generated today; still refuse anything that would escape the root.
        var root = Path.GetFullPath(_options.RootPath);
        var full = Path.GetFullPath(Path.Combine(root, relativePath.TrimStart('/')));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Storage path escaped the storage root.");
        }
        return full;
    }
}
