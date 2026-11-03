"use client";

import { Card } from "@meqyas/ui";
import { ShieldIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/lib/auth/auth-provider";

/** Platform administrators only (the API checks it on every call; this only hides the page). */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin");
  const { user } = useAuth();
  if (!user?.is_platform_admin) {
    return (
      <Card className="mx-auto grid max-w-xl place-items-center gap-3 p-10 text-center">
        <ShieldIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t("adminOnly")}</p>
      </Card>
    );
  }
  return <>{children}</>;
}
