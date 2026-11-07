/**
 * Thin fetch wrapper for the AvatarForge ASP.NET Core API. Browser features (web creator, dashboard)
 * authenticate with the HTTP-only session cookie — `credentials: "include"` on every call so it
 * crosses the dev-mode port boundary (3000 → 5080). The raw X-API-Key flow is for external apps
 * and never used from the browser.
 */
export const API_URL = (process.env.NEXT_PUBLIC_AVATARFORGE_API_URL ?? "http://localhost:5080").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }

  /** Validation problems as a flat list (server returns every problem at once in details.errors). */
  get problems(): string[] {
    const errors = (this.details as { errors?: unknown } | undefined)?.errors;
    return Array.isArray(errors) ? errors.map(String) : [];
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body instanceof Blob ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the AvatarForge API. Check that it's running and try again.");
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const code = body?.error?.code ?? "UNKNOWN_ERROR";
    const message = body?.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message, body?.error?.details);
  }

  return body as T;
}

/** Storage URLs come back relative to the API ("/storage/..."); make them absolute for <img>/downloads. */
export function absoluteApiUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//.test(url) ? url : `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function describeApiError(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiError) {
    const problems = err.problems;
    return problems.length > 1 ? `${err.message} ${problems.slice(0, 3).join(" ")}` : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
