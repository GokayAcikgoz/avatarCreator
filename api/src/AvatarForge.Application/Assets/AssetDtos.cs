namespace AvatarForge.Application.Assets;

public class AssetResponseDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Slot { get; set; } = string.Empty;
    public int Version { get; set; } = 1;
    public string? ThumbnailUrl { get; set; }
    public string? ModelUrl { get; set; }
    public List<string> CompatibleWith { get; set; } = [];
    public List<string> IncompatibleWith { get; set; } = [];
    public Dictionary<string, object?> Metadata { get; set; } = [];
}

public class AssetListQuery
{
    public string? Category { get; set; }
    public string? Slot { get; set; }
    public string? Search { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}
