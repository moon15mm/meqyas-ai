import {
  BuildingIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  FileTextIcon,
  FolderKanbanIcon,
  GiftIcon,
  LayoutDashboardIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  PackageIcon,
  SettingsIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  key:
    | "dashboard"
    | "projects"
    | "templates"
    | "surveys"
    | "results"
    | "reports"
    | "questionBank"
    | "assistant"
    | "settings"
    | "subscribers"
    | "plans"
    | "gifts";
  icon: LucideIcon;
  /** Only platform administrators see it (SUBSCRIPTIONS.md, GIFTS.md). */
  adminOnly?: boolean;
  /** Roadmap phase when the module is not built yet (shown transparently). */
  phase?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", key: "dashboard", icon: LayoutDashboardIcon },
  { href: "/projects", key: "projects", icon: FolderKanbanIcon },
  { href: "/templates", key: "templates", icon: LayoutTemplateIcon },
  { href: "/surveys", key: "surveys", icon: ClipboardListIcon },
  { href: "/results", key: "results", icon: ChartColumnIcon },
  { href: "/reports", key: "reports", icon: FileTextIcon },
  { href: "/question-bank", key: "questionBank", icon: LibraryIcon },
  { href: "/assistant", key: "assistant", icon: SparklesIcon },
  { href: "/settings", key: "settings", icon: SettingsIcon },
  { href: "/admin/subscribers", key: "subscribers", icon: BuildingIcon, adminOnly: true },
  { href: "/admin/plans", key: "plans", icon: PackageIcon, adminOnly: true },
  { href: "/admin/gifts", key: "gifts", icon: GiftIcon, adminOnly: true },
];

/** The navigation this person may use. */
export function visibleNavItems(isPlatformAdmin: boolean | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isPlatformAdmin);
}

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
