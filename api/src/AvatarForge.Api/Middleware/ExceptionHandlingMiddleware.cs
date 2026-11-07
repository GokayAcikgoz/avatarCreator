using System.Text.Json;
using AvatarForge.Application.Common;

namespace AvatarForge.Api.Middleware;

/// <summary>Every endpoint's errors funnel through here into the one ApiErrorResponse shape (CLAUDE.md section 19) — no per-controller try/catch duplication.</summary>
public class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (ApiException ex)
        {
            context.Response.StatusCode = ex.StatusCode;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(
                JsonSerializer.Serialize(new ApiErrorResponse { Error = new ApiErrorBody { Code = ex.Code, Message = ex.Message, Details = ex.Details } }, JsonOptions)
            );
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled exception processing {Method} {Path}", context.Request.Method, context.Request.Path);
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(
                JsonSerializer.Serialize(new ApiErrorResponse { Error = new ApiErrorBody { Code = "INTERNAL_ERROR", Message = "An unexpected error occurred." } }, JsonOptions)
            );
        }
    }
}
