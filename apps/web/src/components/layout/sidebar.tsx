"use client";

import { Badge, cn, Tooltip, TooltipContent, TooltipTrigger } from "@meqyas/ui";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { BrandMark, BrandName } from "@/components/common/brand";
import { useAuth } from "@/lib/auth/auth-provider";

import { isActive, visibleNavItems } from "./nav-config";

export function NavList({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  // Radix "side" is physical: the sidebar sits on the right in RTL, so tooltips open to its left.
  const tooltipSide = useLocale() === "ar" ? "left" : "right";
  const { user } = useAuth();
  const items = visibleNavItems(user?.is_platform_admin);
  return (
    <ul className="grid gap-1">
      {items.map((item, index) => {
        const active = isActive(pathname, item.href);
        const firstAdmin = item.adminOnly && !items[index - 1]?.adminOnly;
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <item.icon
              className={cn(
                "size-[18px] shrink-0",
                active ? "text-primary" : "text-muted-foreground group-hover:text-primary",
              )}
              aria-hidden="true"
            />
            {collapsed ? (
              <span className="visually-hidden">{t(item.key)}</span>
            ) : (
              <span className="flex-1 truncate">{t(item.key)}</span>
            )}
            {!collapsed && item.phase ? (
              <Badge variant="secondary" className="px-1.5 text-[10px] font-normal">
                {tc("comingSoon")}
              </Badge>
            ) : null}
          </Link>
        );
        return (
          <li key={item.href} className={cn(firstAdmin && "mt-3 border-t pt-3")}>
            {firstAdmin && !collapsed ? (
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{t("platformAdmin")}</p>
            ) : null}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side={tooltipSide}>{t(item.key)}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const t = useTranslations("nav");
  const tm = useTranslations("meta");
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-e bg-sidebar transition-[width] duration-200 lg:flex print:hidden",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      <div className={cn("flex h-16 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
        <Link href="/" className="flex items-center gap-3 rounded-lg" aria-label={tm("title")}>
          <BrandMark />
          {!collapsed ? <BrandName tagline={tm("tagline")} /> : null}
        </Link>
      </div>
      <nav aria-label={t("primary")} className="flex-1 overflow-y-auto px-3 py-2">
        <NavList collapsed={collapsed} />
      </nav>
      <div className="border-t p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground hover:bg-sidebar-accent",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          ) : (
            <PanelLeftCloseIcon className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          )}
          {collapsed ? <span className="visually-hidden">{t("expand")}</span> : <span>{t("collapse")}</span>}
        </button>
      </div>
    </aside>
  );
}
