"use client";

import { label, ROLE_LABELS } from "@meqyas/shared";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Sheet,
  SheetContent,
  SheetTitle,
} from "@meqyas/ui";
import {
  Building2Icon,
  ChevronsUpDownIcon,
  LanguagesIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  SearchIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import * as React from "react";

import { BrandMark, BrandName } from "@/components/common/brand";
import { useAuth } from "@/lib/auth/auth-provider";
import { setLocaleCookie } from "@/lib/preferences";

import { useShell } from "./shell-context";
import { NavList } from "./sidebar";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

export function OrgSwitcher() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale() as "ar" | "en";
  const { memberships, activeOrg, switchOrganization } = useAuth();
  const router = useRouter();
  if (!activeOrg) return null;
  return (
    <DropdownMenu dir={locale === "ar" ? "rtl" : "ltr"}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 min-w-0 max-w-[11rem] shrink gap-2 px-2 sm:max-w-[16rem] sm:px-2.5"
          aria-label={t("switchOrganization")}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Building2Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="truncate font-semibold">{activeOrg.organization_name}</span>
          {activeOrg.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t("organization")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={activeOrg.organization_id}
          onValueChange={(id) => {
            switchOrganization(id);
            router.push("/");
          }}
        >
          {memberships.map((m) => (
            <DropdownMenuRadioItem key={m.organization_id} value={m.organization_id}>
              <span className="flex flex-1 flex-col">
                <span className="truncate font-medium">{m.organization_name}</span>
                <span className="text-xs text-muted-foreground">{label(ROLE_LABELS, m.role, locale)}</span>
              </span>
              {m.is_demo ? <Badge variant="demo">{tc("demoData")}</Badge> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageToggle() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("common");
  const next = locale === "ar" ? "en" : "ar";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${t("language")}: ${next === "en" ? "English" : "العربية"}`}
      onClick={() => {
        setLocaleCookie(next);
        router.refresh();
      }}
    >
      <LanguagesIcon aria-hidden="true" />
    </Button>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("common");
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden sm:inline-flex"
      aria-label={`${t("theme")}: ${dark ? t("light") : t("dark")}`}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
    </Button>
  );
}

function UserMenu() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const { user, logout, activeOrg } = useAuth();
  const router = useRouter();
  if (!user) return null;
  return (
    <DropdownMenu dir={locale === "ar" ? "rtl" : "ltr"}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full" aria-label={t("account")}>
          <Avatar>
            <AvatarFallback>{initials(user.full_name) || "؟"}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="text-sm font-semibold text-foreground">{user.full_name}</span>
          <span className="truncate font-normal" dir="ltr">
            {user.email}
          </span>
          {activeOrg ? (
            <span className="font-normal">{label(ROLE_LABELS, activeOrg.role, locale as "ar" | "en")}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">{t("settings")}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          <LogOutIcon aria-hidden="true" />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  const t = useTranslations("nav");
  const tm = useTranslations("meta");
  const { setCommandOpen, setAssistantOpen } = useShell();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const locale = useLocale();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-1 border-b bg-background/85 px-2 backdrop-blur-md sm:gap-2 sm:px-5 print:hidden">
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={t("openMenu")}
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon aria-hidden="true" />
        </Button>
        <SheetContent side="start" className="p-4" closeLabel={t("collapse")}>
          <SheetTitle className="flex items-center gap-3 pb-2">
            <BrandMark />
            <BrandName tagline={tm("tagline")} />
          </SheetTitle>
          <nav aria-label={t("primary")}>
            <NavList onNavigate={() => setMenuOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>

      <OrgSwitcher />

      <div className="min-w-0 flex-1" />

      <Button
        variant="outline"
        className="hidden h-9 w-64 justify-between text-muted-foreground md:inline-flex"
        onClick={() => setCommandOpen(true)}
      >
        <span className="flex items-center gap-2">
          <SearchIcon aria-hidden="true" />
          {t("commandPalette")}
        </span>
        <Kbd dir="ltr">{locale === "ar" ? "Ctrl K" : "⌘/Ctrl K"}</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={t("commandPalette")}
        onClick={() => setCommandOpen(true)}
      >
        <SearchIcon aria-hidden="true" />
      </Button>
      <Button variant="soft" className="hidden gap-2 sm:inline-flex" onClick={() => setAssistantOpen(true)}>
        <SparklesIcon aria-hidden="true" />
        {t("assistant")}
      </Button>
      <LanguageToggle />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
