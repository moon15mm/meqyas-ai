"use client";

import type { Membership, TokenResponse, User } from "@meqyas/shared";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { onSessionChange, refreshSession, setAccessToken, setOrganizationId } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";

const ORG_STORAGE_KEY = "meqyas.activeOrg";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: Status;
  user: User | null;
  memberships: Membership[];
  activeOrg: Membership | null;
  login: (email: string, password: string) => Promise<void>;
  /** Sign in with a session obtained elsewhere (an activation or gift link). */
  adoptSession: (session: TokenResponse) => void;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => void;
  reloadMe: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function pickActiveOrg(memberships: Membership[]): Membership | null {
  if (memberships.length === 0) return null;
  const stored = typeof window !== "undefined" ? window.localStorage.getItem(ORG_STORAGE_KEY) : null;
  return (
    memberships.find((m) => m.organization_id === stored) ??
    memberships.find((m) => !m.is_demo) ??
    memberships[0] ??
    null
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<Status>("loading");
  const [user, setUser] = React.useState<User | null>(null);
  const [memberships, setMemberships] = React.useState<Membership[]>([]);
  const [activeOrg, setActiveOrg] = React.useState<Membership | null>(null);

  const applySession = React.useCallback((session: TokenResponse | null) => {
    if (!session) {
      setAccessToken(null);
      setUser(null);
      setMemberships([]);
      setActiveOrg(null);
      setOrganizationId(null);
      setStatus("anonymous");
      return;
    }
    setAccessToken(session.access_token);
    setUser(session.user);
    setMemberships(session.memberships);
    const active = pickActiveOrg(session.memberships);
    setActiveOrg((current) => {
      const keep = current && session.memberships.find((m) => m.organization_id === current.organization_id);
      const next = keep ?? active;
      setOrganizationId(next?.organization_id ?? null);
      return next ?? null;
    });
    setStatus("authenticated");
  }, []);

  React.useEffect(() => {
    // Respondents on public survey pages never have (or need) a staff session.
    if (window.location.pathname.startsWith("/s/")) {
      setStatus("anonymous");
      return;
    }
    const unsubscribe = onSessionChange(applySession);
    void refreshSession().then((session) => {
      if (!session) applySession(null);
    });
    return () => {
      unsubscribe();
    };
  }, [applySession]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const session = await authApi.login(email, password);
      queryClient.clear();
      applySession(session);
    },
    [applySession, queryClient],
  );

  const adoptSession = React.useCallback(
    (session: TokenResponse) => {
      queryClient.clear();
      const own = session.memberships.find((m) => !m.is_demo);
      if (own) window.localStorage.setItem(ORG_STORAGE_KEY, own.organization_id);
      applySession(session);
    },
    [applySession, queryClient],
  );

  const logout = React.useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      queryClient.clear();
      applySession(null);
    }
  }, [applySession, queryClient]);

  const switchOrganization = React.useCallback(
    (organizationId: string) => {
      const next = memberships.find((m) => m.organization_id === organizationId);
      if (!next) return;
      window.localStorage.setItem(ORG_STORAGE_KEY, organizationId);
      setOrganizationId(organizationId);
      setActiveOrg(next);
      queryClient.clear();
    },
    [memberships, queryClient],
  );

  const reloadMe = React.useCallback(async () => {
    const me = await authApi.me();
    setUser(me.user);
    setMemberships(me.memberships);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      memberships,
      activeOrg,
      login,
      adoptSession,
      logout,
      switchOrganization,
      reloadMe,
    }),
    [status, user, memberships, activeOrg, login, adoptSession, logout, switchOrganization, reloadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Role helpers mirroring the API permission matrix (UI affordances only — the API enforces). */
export function useCan() {
  const { activeOrg } = useAuth();
  const role = activeOrg?.role;
  return {
    role,
    write: role === "OWNER" || role === "ADMIN" || role === "EDITOR",
    useAI: role === "OWNER" || role === "ADMIN" || role === "EDITOR",
    manageOrg: role === "OWNER" || role === "ADMIN",
    deleteProject: role === "OWNER" || role === "ADMIN" || role === "EDITOR",
    /** Individual responses (analysts and above); viewers see aggregates only. */
    readResponses: role === "OWNER" || role === "ADMIN" || role === "EDITOR" || role === "ANALYST",
    /** Raw data exports (CSV/Excel): analysts and admins, not editors. */
    exportResponses: role === "OWNER" || role === "ADMIN" || role === "ANALYST",
    deleteResponses: role === "OWNER" || role === "ADMIN",
    /** Run analyses, generate insights/recommendations, ask the AI analyst (ai.analyze). */
    analyze: role === "OWNER" || role === "ADMIN" || role === "EDITOR" || role === "ANALYST",
    /** Create, refresh, edit and delete reports (reports.create). */
    report: role === "OWNER" || role === "ADMIN" || role === "EDITOR" || role === "ANALYST",
    /** Store connections hold signing secrets: admins and owners only. */
    manageIntegrations: role === "OWNER" || role === "ADMIN",
  };
}
