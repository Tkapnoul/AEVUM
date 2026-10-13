import { apiUrl, authHeaders, isLocal } from "./native";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

/** fetch() against the AEVUM API with the right base URL and credentials for web or native. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const req = { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) } };
  if (isLocal()) {
    // Loaded on first use only, so the server code and SQLite never ship to web/server-mode users' first paint.
    const { localFetch } = await import("../local/runtime");
    return localFetch(`/api${path}`, req);
  }
  return fetch(apiUrl(path), { credentials: "same-origin", ...req });
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await apiFetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers as Record<string, string> | undefined) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = (await res.json()).error ?? code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code);
  }
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const del = <T>(path: string, json?: unknown) => api<T>(path, { method: "DELETE", json });
