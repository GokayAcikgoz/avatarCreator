/**
 * Thin fetch wrapper for the ASP.NET Core API's dashboard-facing endpoints (cookie session auth,
 * not X-API-Key — see AuthController/ProjectsController). credentials: "include" is required on
 * every call so the browser sends/receives the HTTP-only session cookie across origins (the API
 * runs on a different port than the Next.js app in dev).
 */
import { AvatarConfiguration } from "@/features/avatar/config/avatarConfig";
import { apiRequest as request, ApiError } from "@/lib/apiClient";

export { ApiError };

export interface AuthUser {
  id: string;
  email: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  rateLimitPerMinute: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiKeyCreated extends ApiKeySummary {
  key: string;
}

export interface AvatarSummary {
  id: string;
  name: string;
  visibility: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvatarDetail extends AvatarSummary {
  configuration: AvatarConfiguration;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RecentRequest {
  endpoint: string;
  operation: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
}

export interface UsageSummary {
  requestsToday: number;
  requestsThisMonth: number;
  successfulRequests: number;
  failedRequests: number;
  renderCount: number;
  exportCount: number;
  recentRequests: RecentRequest[];
}

export const dashboardApi = {
  register: (email: string, password: string) =>
    request<AuthUser>("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<AuthUser>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),

  me: () => request<AuthUser>("/api/v1/auth/me"),

  listProjects: () => request<Project[]>("/api/v1/projects"),

  createProject: (name: string) =>
    request<Project>("/api/v1/projects", { method: "POST", body: JSON.stringify({ name }) }),

  getProject: (id: string) => request<Project>(`/api/v1/projects/${id}`),

  renameProject: (id: string, name: string) =>
    request<Project>(`/api/v1/projects/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),

  deleteProject: (id: string) => request<void>(`/api/v1/projects/${id}`, { method: "DELETE" }),

  listApiKeys: (projectId: string) => request<ApiKeySummary[]>(`/api/v1/projects/${projectId}/api-keys`),

  createApiKey: (projectId: string, name: string) =>
    request<ApiKeyCreated>(`/api/v1/projects/${projectId}/api-keys`, { method: "POST", body: JSON.stringify({ name }) }),

  revokeApiKey: (projectId: string, keyId: string) =>
    request<void>(`/api/v1/projects/${projectId}/api-keys/${keyId}`, { method: "DELETE" }),

  listProjectAvatars: (projectId: string) =>
    request<PagedResult<AvatarSummary>>(`/api/v1/projects/${projectId}/avatars?pageSize=100`),

  getUsage: (projectId: string) => request<UsageSummary>(`/api/v1/projects/${projectId}/usage`),

  getAvatar: (id: string) => request<AvatarDetail>(`/api/v1/avatars/${id}`),

  renameAvatar: (id: string, name: string) =>
    request<AvatarDetail>(`/api/v1/avatars/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),

  deleteAvatar: (id: string) => request<void>(`/api/v1/avatars/${id}`, { method: "DELETE" }),

  // Global catalog size — same for every project, used only for the dashboard's "Assets" stat.
  getAssetCount: () => request<PagedResult<unknown>>("/api/v1/assets?pageSize=1").then((r) => r.total),
};
