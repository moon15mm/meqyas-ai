"use client";

import { Button, Card, Spinner } from "@meqyas/ui";
import { Building2Icon, LogOutIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";

import { useSubscription } from "@/components/subscription/subscription";
import { SubscriptionBanner, SuspendedScreen } from "@/components/subscription/subscription-banner";
import { useAuth } from "@/lib/auth/auth-provider";

import { AssistantPanel } from "./assistant-panel";
import { BottomNav } from "./bottom-nav";
import { CommandPalette } from "./command-palette";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

const COLLAPSE_KEY = "meqyas.sidebarCollapsed";

/** Signed in, but the account belongs to no workspace (e.g. removed from its last one). */
function NoWorkspace() {
  const t = useTranslations("subscription");
  const tn = useTranslations("nav");
  const { logout } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <Card className="grid max-w-md place-items-center gap-4 p-8 text-center">
        <Building2Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-bold text-balance">{t("noWorkspaceTitle")}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{t("noWorkspaceBody")}</p>
        <Button variant="outline" onClick={() => void logout()}>
          <LogOutIcon aria-hidden="true" />
          {tn("logout")}
        </Button>
      </Card>
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status, activeOrg, memberships } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (status === "anonymous") {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${next}`);
    }
  }, [status, router, pathname]);

  if (status === "authenticated" && memberships.length === 0) return <NoWorkspace />;
  if (status !== "authenticated" || !activeOrg) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6 text-primary" />
      </div>
    );
  }
  return <>{children}</>;
}

/** A suspended workspace is closed (SUBSCRIPTIONS.md): only the platform pages stay open. */
function WorkspaceContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const suspended = useSubscription()?.state === "SUSPENDED";
  if (suspended && !pathname.startsWith("/admin")) return <SuspendedScreen />;
  return (
    <>
      <div className="print:hidden">
        <SubscriptionBanner />
      </div>
      {children}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  return (
    <AuthGuard>
      <ShellProvider>
        <a href="#content" className="skip-link">
          {t("skipToContent")}
        </a>
        <div className="flex min-h-dvh">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main
              id="content"
              tabIndex={-1}
              className="flex-1 px-4 pt-6 pb-28 outline-none sm:px-6 lg:px-8 lg:pb-12 print:p-0"
            >
              <WorkspaceContent>{children}</WorkspaceContent>
            </main>
          </div>
        </div>
        <BottomNav />
        <CommandPalette />
        <AssistantPanel />
      </ShellProvider>
    </AuthGuard>
  );
}
