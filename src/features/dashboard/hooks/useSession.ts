"use client";

import { useEffect, useState, useCallback } from "react";
import { dashboardApi, AuthUser, ApiError } from "../api/client";

export function useSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await dashboardApi.me();
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        console.error("[useSession] failed to load session", err);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .me()
      .then((me) => !cancelled && setUser(me))
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error("[useSession] failed to load session", err);
        if (!cancelled) setUser(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading, refresh };
}
