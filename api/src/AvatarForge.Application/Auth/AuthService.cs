using AvatarForge.Application.Common;
using AvatarForge.Application.Users;
using AvatarForge.Domain.Entities;

namespace AvatarForge.Application.Auth;

/// <summary>
/// Dashboard authentication — deliberately separate from ApiKeyService (CLAUDE.md Phase 8 §2:
/// "API authentication ile dashboard authentication'ı birbirine karıştırma"). This never issues
/// or checks an X-API-Key; the Api layer's AuthController turns a successful login into a
/// cookie session, which is a hosting concern this layer doesn't know about.
/// </summary>
public class AuthService(IUserRepository userRepository)
{
    public async Task<AuthUserResponseDto> RegisterAsync(RegisterRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || !request.Email.Contains('@'))
        {
            throw new ApiException(ErrorCodes.ValidationFailed, "A valid email is required.", statusCode: 400);
        }
        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
        {
            throw new ApiException(ErrorCodes.ValidationFailed, "Password must be at least 8 characters.", statusCode: 400);
        }

        var existing = await userRepository.GetByEmailAsync(request.Email, ct);
        if (existing is not null)
        {
            throw new ApiException("EMAIL_ALREADY_REGISTERED", "An account with this email already exists.", statusCode: 409);
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = request.Email,
            PasswordHash = PasswordHasher.Hash(request.Password),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        await userRepository.AddAsync(user, ct);
        await userRepository.SaveChangesAsync(ct);

        return new AuthUserResponseDto { Id = user.Id, Email = user.Email };
    }

    /// <summary>Returns null on any failure (unknown email, no password set, wrong password) — the caller must not distinguish these to an unauthenticated client.</summary>
    public async Task<User?> ValidateCredentialsAsync(LoginRequest request, CancellationToken ct = default)
    {
        var user = await userRepository.GetByEmailAsync(request.Email, ct);
        if (user?.PasswordHash is null) return null;
        return PasswordHasher.Verify(request.Password, user.PasswordHash) ? user : null;
    }
}
