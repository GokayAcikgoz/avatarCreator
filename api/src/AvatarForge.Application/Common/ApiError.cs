namespace AvatarForge.Application.Common;

/// <summary>Standard error envelope for every endpoint (CLAUDE.md section 19) — no endpoint gets to invent its own shape.</summary>
public class ApiErrorResponse
{
    public ApiErrorBody Error { get; set; } = new();
}

public class ApiErrorBody
{
    public string Code { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public object? Details { get; set; }
}

public static class ErrorCodes
{
    public const string AssetNotFound = "ASSET_NOT_FOUND";
    public const string AvatarNotFound = "AVATAR_NOT_FOUND";
    public const string ProjectNotFound = "PROJECT_NOT_FOUND";
    public const string IncompatibleAssets = "INCOMPATIBLE_ASSETS";
    public const string InvalidConfiguration = "INVALID_CONFIGURATION";
    public const string Unauthorized = "UNAUTHORIZED";
    public const string Forbidden = "FORBIDDEN";
    public const string RateLimited = "RATE_LIMITED";
    public const string ValidationFailed = "VALIDATION_FAILED";
}

/// <summary>Thrown by application services; a single exception-handling middleware turns this into the ApiErrorResponse envelope with the right HTTP status.</summary>
public class ApiException(string code, string message, int statusCode, object? details = null) : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
    public object? Details { get; } = details;
}
