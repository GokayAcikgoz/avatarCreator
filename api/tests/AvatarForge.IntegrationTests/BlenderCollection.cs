namespace AvatarForge.IntegrationTests;

/// <summary>
/// Every test class that shells out to a real Blender process joins this collection, so they run
/// one after another instead of in parallel: Blender is CPU/GPU-heavy, and the temp-directory
/// cleanup assertion is only meaningful when no other render is in flight.
/// </summary>
[CollectionDefinition(Name)]
public class BlenderCollection
{
    public const string Name = "Blender renders";
}
