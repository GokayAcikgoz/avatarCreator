namespace AvatarForge.Domain.Entities;

/// <summary>
/// Mirrors an entry of shared/asset-catalog.json (seeded/upserted by AssetSeeder on every boot) —
/// the same catalog the web creator imports, now servable over the API. Category/slot are data,
/// never an enum (CLAUDE.md section 5).
/// Id is the same human-readable string key already used everywhere in the frontend manifest
/// (e.g. "hair_short_bob") — using it as the primary key avoids a redundant id-mapping layer,
/// since compatibleWith/incompatibleWith already reference assets by this exact string.
/// </summary>
public class Asset
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Slot { get; set; } = string.Empty;
    public string? Attachment { get; set; }

    public string? ModelUrl { get; set; }
    public string? ThumbnailUrl { get; set; }

    public List<string> CompatibleWith { get; set; } = [];
    public List<string> IncompatibleWith { get; set; } = [];
    public List<string> Tags { get; set; } = [];
    /// <summary>Style themes ("smart", "street", "summer"...) the randomizer uses to build coherent outfits.</summary>
    public List<string> Styles { get; set; } = [];
    /// <summary>Rendered on every avatar (eyes, teeth...) — never user-selectable.</summary>
    public bool AlwaysOn { get; set; }
    public List<string>? Colors { get; set; }

    public int? AssetVersion { get; set; }
    public string? License { get; set; }
    public string? Author { get; set; }
    public string? Source { get; set; }
    public List<string>? Materials { get; set; }
}
