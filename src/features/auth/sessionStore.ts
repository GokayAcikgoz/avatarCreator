"use client";

import { create } from "zustand";
import { ApiError } from "@/lib/apiClient";
import { AuthUser, dashboardApi } from "@/features/dashboard/api/client";

type SessionStatus = "unknown" | "loading" | "signedIn" | "signedOut";

interface SessionState {
  user: AuthUser | null;
  status: SessionStatus;
  refresh: () => Promise<AuthUser | null>;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  register: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

/**
 * One account system for everything: the same cookie session signs a person into the web creator
 * (their saved avatars) and the developer dashboard (projects, API keys). The session itself is an
 * HTTP-only cookie the API sets; this store only mirrors "who am I" for the UI.
 */
export const useSession = create<SessionState>((set, get) => ({
  user: null,
  status: "unknown",

  refresh: async () => {
    if (get().status === "unknown") set({ status: "loading" });
    try {
      const user = await dashboardApi.me();
      set({ user, status: "signedIn" });
      return user;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) console.warn("[session] could not reach the API", err);
      set({ user: null, status: "signedOut" });
      return null;
    }
  },

  signIn: async (email, password) => {
    const user = await dashboardApi.login(email, password);
    set({ user, status: "signedIn" });
    return user;
  },

  register: async (email, password) => {
    await dashboardApi.register(email, password);
    return get().signIn(email, password);
  },

  signOut: async () => {
    try {
      await dashboardApi.logout();
    } finally {
      set({ user: null, status: "signedOut" });
    }
  },
}));
