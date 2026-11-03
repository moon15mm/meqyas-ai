"use client";

import { cn } from "@meqyas/ui";
import {
  ChartColumnIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { isActive } from "./nav-config";
import { useShell } from "./shell-context";

/** Mobile bottom navigation with a central "new measurement" action. */
export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { setAssistantOpen } = useShell();
  const items = [
    { href: "/", key: "dashboard" as const, icon: LayoutDashboardIcon },
    { href: "/projects", key: "projects" as const, icon: FolderKanbanIcon },
    null,
    { href: "/results", key: "results" as const, icon: ChartColumnIcon },
    { href: "/settings", key: "settings" as const, icon: SettingsIcon },
  ];
  return (
    <nav
      aria-label={t("primary")}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden print:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
        {items.map((item, i) =>
          item ? (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground",
                  isActive(pathname, item.href) && "text-primary",
                )}
              >
                <item.icon className="size-5" aria-hidden="true" />
                {t(item.key)}
              </Link>
            </li>
          ) : (
            <li key={`center-${i}`} className="flex justify-center">
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                className="brand-gradient -mt-6 flex size-14 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-background"
                aria-label={t("newMeasurement")}
              >
                <SparklesIcon className="size-6" aria-hidden="true" />
              </button>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
