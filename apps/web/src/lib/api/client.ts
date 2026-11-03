/**
 * Typed fetch client for the MEQYAS API (same-origin via the Next.js /api proxy).
 *
 * - Access token lives in memory only (never localStorage).
 * - On 401 the client performs ONE single-flight refresh (HttpOnly cookie) and retries.
 * - The active organization is sent as X-Organization-Id.
 */
import type { ApiErrorBody, TokenResponse } from "@meqyas/shared";

const API_BASE = "/api/v1";
const CSRF_HEADER = { "X-Requested-With": "meqyas" };

let accessToken: string | null = null;
let organizationId: string | null = null;
let locale = "ar";
let refreshInFlight: Promise<TokenResponse | null> | null = null;

type SessionListener = (session: TokenResponse | null) => void;
const sessionListeners = new Set<SessionListener>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setOrganizationId(id: string | null): void {
  organizationId = id;
}

export function setApiLocale(value: string): void {
  locale = value;
}

export function onSessionChange(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function emitSession(session: TokenResponse | null): void {
  for (const listener of sessionListeners) listener(session);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body?.error) {
      return new ApiError(res.status, body.error.code, body.error.message, body.error.details ?? {});
    }
  } catch {
    // non-JSON error (e.g. proxy failure)
  }
  return new ApiError(
    res.status,
    res.status >= 500 ? "server_error" : "http_error",
    res.statusText || "Request failed",
  );
}

/** Single-flight refresh using the HttpOnly refresh cookie. Returns null when the session is gone. */
export function refreshSession(): Promise<TokenResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: CSRF_HEADER,
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) {
          accessToken = null;
          emitSession(null);
          return null;
        }
        const session = (await res.json()) as TokenResponse;
        accessToken = session.access_token;
        emitSession(session);
        return session;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Send X-Organization-Id (default true). */
  scoped?: boolean;
  /** Attach the bearer token and refresh on 401 (default true). */
  auth?: boolean;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, scoped = true, auth = true, headers = {} } = options;

  const send = () => {
    const h: Record<string, string> = { Accept: "application/json", "Accept-Language": locale, ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (auth && accessToken) h.Authorization = `Bearer ${accessToken}`;
    if (scoped && organizationId) h["X-Organization-Id"] = organizationId;
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Network error");
  }

  if (res.status === 401 && auth) {
    const session = await refreshSession();
    if (session) {
      res = await send();
    }
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Authenticated binary download (e.g. QR images) with the same refresh-on-401 behaviour. */
export async function apiBlob(path: string): Promise<Blob> {
  const send = () => {
    const h: Record<string, string> = { "Accept-Language": locale };
    if (accessToken) h.Authorization = `Bearer ${accessToken}`;
    if (organizationId) h["X-Organization-Id"] = organizationId;
    return fetch(`${API_BASE}${path}`, { headers: h, credentials: "same-origin" });
  };
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

export async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": locale,
      ...CSRF_HEADER,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}
