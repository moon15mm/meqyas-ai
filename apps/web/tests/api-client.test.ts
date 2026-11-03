import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, refreshSession, setAccessToken, setOrganizationId } from "@/lib/api/client";

const session = {
  access_token: "new-token",
  token_type: "bearer",
  expires_in: 900,
  user: { id: "u1", email: "a@b.example", full_name: "A", locale: "ar", created_at: "" },
  memberships: [],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("old-token");
    setOrganizationId("org-1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends bearer token and organization header", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api("/projects");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/projects");
    expect(init.headers.Authorization).toBe("Bearer old-token");
    expect(init.headers["X-Organization-Id"]).toBe("org-1");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: "token_expired", message: "expired" } }))
      .mockResolvedValueOnce(json(200, session))
      .mockResolvedValueOnce(json(200, { items: [] }));
    const result = await api<{ items: unknown[] }>("/projects");
    expect(result.items).toEqual([]);
    const refreshCall = fetchMock.mock.calls[1]!;
    expect(refreshCall[0]).toBe("/api/v1/auth/refresh");
    expect(refreshCall[1].headers["X-Requested-With"]).toBe("meqyas");
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe("Bearer new-token");
  });

  it("coalesces concurrent refreshes into a single request", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const a = refreshSession();
    const b = refreshSession();
    resolve(json(200, session));
    await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps API errors to ApiError with code", async () => {
    fetchMock.mockResolvedValueOnce(
      json(503, { error: { code: "ai_not_configured", message: "no key", details: {} } }),
    );
    await expect(api("/ai/measurement-architect", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 503,
      code: "ai_not_configured",
    });
  });

  it("reports network failures as network_error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = await api("/projects").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("network_error");
  });
});
