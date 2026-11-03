"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@meqyas/ui";
import { useQuery } from "@tanstack/react-query";
import { Building2Icon, FolderIcon, LanguagesIcon, MoonIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { projectApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth/auth-provider";
import { setLocaleCookie } from "@/lib/preferences";

import { visibleNavItems } from "./nav-config";
import { useShell } from "./shell-context";

export function CommandPalette() {
  const t = useTranslations("commands");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { commandOpen, setCommandOpen, setAssistantOpen } = useShell();
  const { user, memberships, activeOrg, switchOrganization } = useAuth();
  const projects = useQuery({
    queryKey: ["projects", { q: "" }],
    queryFn: () => projectApi.list({ limit: 50 }),
    enabled: commandOpen && !!activeOrg,
  });

  const run = (fn: () => void) => {
    setCommandOpen(false);
    fn();
  };

  return (
    <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
      <DialogContent className="max-w-xl overflow-hidden p-0" hideClose>
        <DialogTitle className="visually-hidden">{tn("commandPalette")}</DialogTitle>
        <Command loop>
          <CommandInput placeholder={t("placeholder")} />
          <CommandList>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            <CommandGroup heading={t("actions")}>
              <CommandItem onSelect={() => run(() => router.push("/?focus=1"))}>
                <SparklesIcon aria-hidden="true" />
                {t("newMeasurement")}
              </CommandItem>
              <CommandItem onSelect={() => run(() => router.push("/projects?new=1"))}>
                <PlusIcon aria-hidden="true" />
                {t("newProject")}
              </CommandItem>
              <CommandItem onSelect={() => run(() => setAssistantOpen(true))}>
                <SparklesIcon aria-hidden="true" />
                {t("openAssistant")}
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  run(() => {
                    setLocaleCookie(locale === "ar" ? "en" : "ar");
                    router.refresh();
                  })
                }
              >
                <LanguagesIcon aria-hidden="true" />
                {t("toggleLanguage")}
              </CommandItem>
              <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
                <MoonIcon aria-hidden="true" />
                {t("toggleTheme")}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t("navigation")}>
              {visibleNavItems(user?.is_platform_admin).map((item) => (
                <CommandItem
                  key={item.href}
                  value={`nav ${tn(item.key)}`}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  <item.icon aria-hidden="true" />
                  {tn(item.key)}
                </CommandItem>
              ))}
            </CommandGroup>
            {projects.data?.items.length ? (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("projects")}>
                  {projects.data.items.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`project ${p.title} ${p.id}`}
                      onSelect={() => run(() => router.push(`/projects/${p.id}`))}
                    >
                      <FolderIcon aria-hidden="true" />
                      <span className="truncate">{p.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
            {memberships.length > 1 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("organizations")}>
                  {memberships.map((m) => (
                    <CommandItem
                      key={m.organization_id}
                      value={`org ${m.organization_name} ${m.organization_id}`}
                      disabled={m.organization_id === activeOrg?.organization_id}
                      onSelect={() =>
                        run(() => {
                          switchOrganization(m.organization_id);
                          router.push("/");
                        })
                      }
                    >
                      <Building2Icon aria-hidden="true" />
                      {m.organization_name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
