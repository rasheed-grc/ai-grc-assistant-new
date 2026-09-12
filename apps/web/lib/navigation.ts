import {
  LayoutDashboard,
  ShieldCheck,
  TriangleAlert,
  Library,
  FileText,
  FolderArchive,
  Sparkles,
  Workflow,
  Settings,
  LifeBuoy,
  Users,
  Bot,
  Gavel,
  UserCheck,
  Compass,
  BookMarked,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/auth/roles";
import { can, type Action, type ResourceType } from "@/lib/auth/permissions";

/**
 * Single source of truth for the workspace navigation (CLAUDE.md §21/§22 —
 * no magic route strings scattered across the UI). The Sidebar renders these,
 * and each `href` maps to a real route under `app/`. P1 ships the shell only:
 * destinations resolve to placeholder pages until later roadmap phases.
 */

export interface NavLink {
  /** English fallback label — kept for non-translated contexts (metadata, tests). */
  label: string;
  /** Key into the `nav.items` next-intl namespace (messages/{locale}.json); Sidebar
   * renders `t(labelKey)` so nav copy is locale-aware. */
  labelKey: string;
  /**
   * Locale-agnostic logical path (e.g. "/dashboard") — rendered through `@/i18n/navigation`'s
   * `Link`, which prefixes the current locale. Typed as `string`, not Next's `Route` brand:
   * `typedRoutes` validates against the literal `/[locale]/...` file-system routes, which
   * would force every nav href to be written with a hardcoded locale segment.
   */
  href: string;
  icon: LucideIcon;
  /** Small count/status pill (e.g. "7", "New"). Presentational only in P1. */
  badge?: string;
  /** Coarse role gate — item is hidden unless the user holds one of these roles. */
  requiredRoles?: UserRole[];
  /** Fine-grained gate — item is hidden unless the user can perform this on the resource. */
  requiredPermission?: { action: Action; resource: ResourceType };
  /**
   * Gate on a capability that is NOT a tenant role. `governsKnowledge` is the only one: sector
   * knowledge is authored once for every organization in a sector, so the authority to change it
   * cannot be something a customer's workspace grants. Resolved server-side and carried on the
   * session; the sidebar only reads the answer.
   */
  requiredCapability?: "governsKnowledge";
}

export interface NavGroup {
  label: string;
  /** Key into the `nav.groups` next-intl namespace. */
  labelKey: string;
  items: NavLink[];
}

export const PRIMARY_NAV: NavGroup[] = [
  {
    label: "Overview",
    labelKey: "overview",
    items: [
      {
        label: "Executive Dashboard",
        labelKey: "dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        label: "AI Assistant",
        labelKey: "aiAssistant",
        href: "/workspace",
        icon: Sparkles,
        badge: "New",
      },
      {
        // One entry for the whole Discovery -> Report -> Plan journey (Product Flow
        // Simplification): `/discovery` itself redirects straight to `/plan` server-side once a
        // plan already exists, so this single link always lands the user in the right place —
        // no separate, competing "Governance Plan" nav item to disambiguate from.
        label: "Governance Program",
        labelKey: "discovery",
        href: "/discovery",
        icon: Compass,
        badge: "New",
      },
      { label: "Missions", labelKey: "missions", href: "/missions", icon: Workflow },
      {
        // Internal, and hidden from everyone who does not govern knowledge. Hiding it is a
        // courtesy, not the control: the page refuses server-side and so does grc-api.
        label: "Sector Knowledge",
        labelKey: "knowledge",
        href: "/knowledge",
        icon: BookMarked,
        requiredCapability: "governsKnowledge",
      },
    ],
  },
  {
    label: "Governance",
    labelKey: "governance",
    items: [
      { label: "Controls", labelKey: "controls", href: "/controls", icon: ShieldCheck },
      { label: "Policies", labelKey: "policies", href: "/policies", icon: FileText },
      { label: "Frameworks", labelKey: "frameworks", href: "/frameworks", icon: Library },
    ],
  },
  {
    label: "Risk & Compliance",
    labelKey: "riskCompliance",
    items: [
      {
        label: "Risk Register",
        labelKey: "riskRegister",
        href: "/risk-register",
        icon: TriangleAlert,
      },
      { label: "Evidence", labelKey: "evidence", href: "/evidence", icon: FolderArchive },
      { label: "Reports", labelKey: "reports", href: "/reports", icon: FileText },
    ],
  },
];

export const FOOTER_NAV: NavLink[] = [
  // Admin-only (matches the server guard on the page itself — CLAUDE.md §20).
  {
    label: "AI Worker",
    labelKey: "aiWorker",
    href: "/ai-worker",
    icon: Bot,
    requiredRoles: ["owner", "admin"],
  },
  {
    label: "Regulation Review",
    labelKey: "regulationReview",
    href: "/regulation-review",
    icon: Gavel,
    requiredRoles: ["owner", "admin"],
  },
  {
    label: "Access Requests",
    labelKey: "accessRequests",
    href: "/access-requests",
    icon: UserCheck,
    requiredRoles: ["owner", "admin"],
  },
  // Team management and workspace administration are both restricted to owners and admins
  // (matches each page's own server guard).
  {
    label: "Team",
    labelKey: "team",
    href: "/team",
    icon: Users,
    requiredRoles: ["owner", "admin"],
  },
  {
    label: "Settings",
    labelKey: "settings",
    href: "/settings",
    icon: Settings,
    requiredRoles: ["owner", "admin"],
  },
  { label: "Help & Support", labelKey: "help", href: "/help", icon: LifeBuoy },
];

/**
 * Active-state matcher. The dashboard ("/dashboard") must match exactly so it does not
 * light up on every route; section roots match themselves and any nested path.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface NavCapabilities {
  governsKnowledge?: boolean;
}

/** Whether the given roles satisfy an item's role + permission + capability gates (default
 * allow). A capability the caller did not supply is treated as absent, never as granted. */
export function canSeeNavItem(
  item: NavLink,
  roles: readonly UserRole[],
  capabilities: NavCapabilities = {},
): boolean {
  if (item.requiredCapability && !capabilities[item.requiredCapability]) {
    return false;
  }
  if (item.requiredRoles && !item.requiredRoles.some((role) => roles.includes(role))) {
    return false;
  }
  if (
    item.requiredPermission &&
    !can(roles, item.requiredPermission.action, item.requiredPermission.resource)
  ) {
    return false;
  }
  return true;
}
