using AvatarForge.Application.Catalog;

namespace AvatarForge.Application.Animation;

/// <summary>A single frozen pose: per-bone rotation deltas (x,y,z,w — applied on top of the bone's rest rotation) plus a root translation delta (armature space, meters).</summary>
public sealed class SampledPose
{
    public Dictionary<string, double[]> Bones { get; init; } = [];
    public double[] Root { get; init; } = [0, 0, 0];
}

/// <summary>
/// Samples a clip from shared/animation-clips.json at an arbitrary time, the same way the web
/// viewer's AnimationMixer does (linear interpolation between frames, spherical for rotations), so
/// a server render of "wave at t=0.4s" matches what the browser shows at that moment.
/// </summary>
public static class AnimationSampler
{
    public static SampledPose Sample(AnimationClipDefinition clip, double timeSeconds)
    {
        var frames = Math.Max(1, clip.Frames);
        var t = clip.Duration <= 0 ? 0 : clip.Loop ? Mod(timeSeconds, clip.Duration) : Math.Clamp(timeSeconds, 0, clip.Duration);
        var position = frames == 1 ? 0 : t / clip.Duration * (frames - 1);
        var i0 = Math.Clamp((int)Math.Floor(position), 0, frames - 1);
        var i1 = Math.Min(i0 + 1, frames - 1);
        var alpha = position - i0;

        var bones = new Dictionary<string, double[]>();
        foreach (var (bone, values) in clip.Tracks)
        {
            if (values.Count == 4)
            {
                bones[bone] = [values[0], values[1], values[2], values[3]];
                continue;
            }
            bones[bone] = Slerp(Quat(values, i0), Quat(values, i1), alpha);
        }

        double[] root = [0, 0, 0];
        if (clip.Root.Count == 3)
        {
            root = [clip.Root[0], clip.Root[1], clip.Root[2]];
        }
        else if (clip.Root.Count >= frames * 3)
        {
            for (var k = 0; k < 3; k++)
            {
                root[k] = clip.Root[i0 * 3 + k] + (clip.Root[i1 * 3 + k] - clip.Root[i0 * 3 + k]) * alpha;
            }
        }

        return new SampledPose { Bones = bones, Root = root };
    }

    private static double Mod(double value, double modulus) => ((value % modulus) + modulus) % modulus;

    private static double[] Quat(List<double> values, int frame) =>
        [values[frame * 4], values[frame * 4 + 1], values[frame * 4 + 2], values[frame * 4 + 3]];

    private static double[] Slerp(double[] a, double[] b, double t)
    {
        var dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        if (dot < 0)
        {
            b = [-b[0], -b[1], -b[2], -b[3]];
            dot = -dot;
        }
        if (dot > 0.9995)
        {
            var lerped = new double[4];
            for (var k = 0; k < 4; k++) lerped[k] = a[k] + (b[k] - a[k]) * t;
            return Normalize(lerped);
        }
        var theta = Math.Acos(dot);
        var sinTheta = Math.Sin(theta);
        var wa = Math.Sin((1 - t) * theta) / sinTheta;
        var wb = Math.Sin(t * theta) / sinTheta;
        return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
    }

    private static double[] Normalize(double[] q)
    {
        var len = Math.Sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        return len == 0 ? [0, 0, 0, 1] : [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
    }
}
