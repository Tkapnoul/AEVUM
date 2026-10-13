import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/** Minimal data hook: load on mount / when `path` changes, expose `reload`. `null` path skips. */
export function useFetch<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (current.current === path) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (current.current === path) setError(e instanceof ApiError ? e : new ApiError(0, "network"));
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(path !== null);
    void load();
    if (!opts.pollMs || !path) return;
    const id = setInterval(() => document.visibilityState === "visible" && void load(), opts.pollMs);
    return () => clearInterval(id);
  }, [load, path, opts.pollMs]);

  return { data, error, loading, reload: load, setData };
}
