using System.Text.Json.Serialization;
using AvatarForge.Api.Authentication;
using AvatarForge.Api.Middleware;
using AvatarForge.Application.ApiKeys;
using AvatarForge.Application.Assets;
using AvatarForge.Application.Auth;
using AvatarForge.Application.Avatars;
using AvatarForge.Application.Projects;
using AvatarForge.Application.Rendering;
using AvatarForge.Application.Storage;
using AvatarForge.Application.Usage;
using AvatarForge.Application.Users;
using AvatarForge.Infrastructure.Persistence;
using AvatarForge.Infrastructure.Rendering;
using AvatarForge.Infrastructure.Storage;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new Microsoft.OpenApi.OpenApiInfo
    {
        Title = "AvatarForge API",
        Version = "v1",
        Description = "Avatar creation platform API — assets, avatars, projects, API keys. See docs/api-platform.md for the full guide.",
    });
    c.AddSecurityDefinition(ApiKeyAuthenticationDefaults.SchemeName, new Microsoft.OpenApi.OpenApiSecurityScheme
    {
        Name = ApiKeyAuthenticationDefaults.HeaderName,
        Type = Microsoft.OpenApi.SecuritySchemeType.ApiKey,
        In = Microsoft.OpenApi.ParameterLocation.Header,
        Description = "API key created by a signed-in project owner (dashboard → POST /api/v1/projects/{id}/api-keys), e.g. af_live_...",
    });
});

builder.Services.AddDbContext<AvatarForgeDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

builder.Services.Configure<LocalStorageOptions>(builder.Configuration.GetSection("LocalStorage"));
builder.Services.Configure<BlenderOptions>(builder.Configuration.GetSection("Blender"));

// Application services
builder.Services.AddScoped<AssetCatalogService>();
builder.Services.AddScoped<CompatibilityValidator>();
builder.Services.AddScoped<AvatarService>();
builder.Services.AddScoped<ProjectService>();
builder.Services.AddScoped<ApiKeyService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<UsageQueryService>();

// Repositories / infrastructure adapters
builder.Services.AddScoped<IAssetRepository, EfAssetRepository>();
builder.Services.AddScoped<IAvatarRepository, EfAvatarRepository>();
builder.Services.AddScoped<IUserRepository, EfUserRepository>();
builder.Services.AddScoped<IProjectRepository, EfProjectRepository>();
builder.Services.AddScoped<IApiKeyRepository, EfApiKeyRepository>();
builder.Services.AddScoped<IUsageTracker, EfUsageTracker>();
builder.Services.AddScoped<IUsageQueryRepository, EfUsageQueryRepository>();
builder.Services.AddSingleton<IObjectStorage, LocalFileSystemObjectStorage>();
builder.Services.AddScoped<IAssetResolver, AssetResolver>();
builder.Services.AddScoped<IAvatarRenderer, BlenderAvatarRenderer>();

// Two independent auth schemes, never mixed (CLAUDE.md Phase 8 §2): X-API-Key for the developer
// product API (AssetsController/AvatarsController), a secure HTTP-only cookie for the dashboard
// (AuthController + dashboard-only endpoints). Default scheme is ApiKey since more of the API
// surface uses it; dashboard endpoints opt into Cookies explicitly via [Authorize(...)].
builder.Services.AddAuthentication(ApiKeyAuthenticationDefaults.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(ApiKeyAuthenticationDefaults.SchemeName, _ => { })
    .AddCookie(DashboardAuthenticationDefaults.SchemeName, options =>
    {
        options.Cookie.Name = "avatarforge_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        // This is an API consumed by fetch() from the Next.js dashboard, not a server-rendered
        // app — an unauthenticated call must get a real 401/403 JSON-able status, never a 302
        // redirect to a login page that doesn't exist on this host.
        options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

// CORS (CLAUDE.md Phase 8 §8): allowed origins come from configuration, never a hardcoded
// wildcard. "AllowedOrigins" in appsettings.Development.json is permissive for local dev;
// production must set API_ALLOWED_ORIGINS (comma-separated) as a real environment variable.
var allowedOrigins = (Environment.GetEnvironmentVariable("API_ALLOWED_ORIGINS")
        ?? builder.Configuration["Cors:AllowedOrigins"]
        ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length == 0)
        {
            // Fails closed, not open — an unconfigured production deployment should reject
            // cross-origin calls, not silently allow everything.
            policy.WithOrigins("http://localhost:__none__");
        }
        else
        {
            policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
        }
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AvatarForgeDbContext>();
    db.Database.Migrate();
    await AssetSeeder.SeedAsync(db);
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseStaticFiles();

// Serves whatever LocalFileSystemObjectStorage writes (renders/exports) back out at the same
// PublicBaseUrl ("/storage") its SaveAsync returns — without this, every render/export URL 404s.
var storageOptions = app.Services.GetRequiredService<IOptions<LocalStorageOptions>>().Value;
Directory.CreateDirectory(storageOptions.RootPath);
// .glb isn't in ASP.NET Core's default MIME map, so the static file middleware 404s it unless a
// content type is explicitly registered — found by actually downloading an exported file, not
// assumed.
var storageContentTypes = new FileExtensionContentTypeProvider();
storageContentTypes.Mappings[".glb"] = "model/gltf-binary";
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Path.GetFullPath(storageOptions.RootPath)),
    RequestPath = storageOptions.PublicBaseUrl,
    ContentTypeProvider = storageContentTypes,
});

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<RateLimitingMiddleware>();
// UsageTrackingMiddleware wraps ExceptionHandlingMiddleware (not the other way around) so that
// by the time its post-next() code runs, any exception has already been turned into a real
// status code (400/501/500/...) by the inner handler — otherwise a thrown ApiException would
// unwind straight past the tracking code and failed calls would silently go unrecorded.
app.UseMiddleware<UsageTrackingMiddleware>();
app.UseMiddleware<ExceptionHandlingMiddleware>();

app.MapControllers();

app.Run();

public partial class Program;
