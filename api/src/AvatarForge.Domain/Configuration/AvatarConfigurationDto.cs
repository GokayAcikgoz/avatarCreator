namespace AvatarForge.Domain.Configuration;

/// <summary>
/// Byte-for-byte mirror of the frontend's AvatarConfigurationSchema
/// (src/features/avatar/config/avatarConfig.ts) — same fields, same nesting, same defaults.
/// This is the single canonical shape (CLAUDE.md section 18: "Tek bir canonical schema
/// belirle"). Serialized with camelCase JSON naming so a config round-trips through the API
/// unchanged in either direction. Stored as a jsonb/text blob on Avatar, not decomposed into
/// relational columns — CLAUDE.md section 2 explicitly says reuse this shape, not redesign it.
/// </summary>
public class AvatarConfigurationDto
{
    public int Version { get; set; } = 1;
    public BodyDto Body { get; set; } = new();
    public FaceDto Face { get; set; } = new();
    public HairDto Hair { get; set; } = new();
    public FacialHairDto FacialHair { get; set; } = new();
    public ClothingDto Clothing { get; set; } = new();
    public List<string> Accessories { get; set; } = [];
    public Dictionary<string, string> AccessoryColors { get; set; } = [];
}

public class BodyDto
{
    public string Type { get; set; } = "unisex";
    public double Height { get; set; } = 0.5;
    public double ShoulderWidth { get; set; } = 0.5;
    public double Proportion { get; set; } = 0.5;
}

public class FaceDto
{
    public string Shape { get; set; } = "oval";
    public string SkinTone { get; set; } = "#C68863";
    public string EyeShape { get; set; } = "almond";
    public string EyeColor { get; set; } = "#3B2415";
    public string Eyebrows { get; set; } = "natural";
    public string Nose { get; set; } = "straight";
    public string Mouth { get; set; } = "neutral";
    public string EarShape { get; set; } = "standard";
    public Dictionary<string, double> Morphs { get; set; } = [];
    public string Expression { get; set; } = "neutral";
}

public class HairDto
{
    public string? Style { get; set; } = "hair_short_bob";
    public string Color { get; set; } = "#3B2415";
}

public class FacialHairDto
{
    public string? BeardStyle { get; set; }
    public string? MustacheStyle { get; set; }
    public string Color { get; set; } = "#24160E";
}

public class ClothingDto
{
    public string? Top { get; set; } = "top_tshirt";
    public string TopColor { get; set; } = "#111111";
    public string? Bottom { get; set; } = "bottom_wool_pants";
    public string BottomColor { get; set; } = "#495057";
    public string? Shoes { get; set; } = "shoes_cloth";
    public string ShoesColor { get; set; } = "#F5F5F5";
}
