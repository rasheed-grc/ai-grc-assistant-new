"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Shield, User, UsersRound } from "lucide-react";
import { useSession } from "@/components/auth/SessionProvider";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SecurityAccessForm } from "@/components/account/SecurityAccessForm";
import { OrganizationForm } from "@/components/settings/OrganizationForm";
import { TeamManagement } from "@/components/settings/TeamManagement";
import { cn } from "@/lib/utils";

const TABS = ["profile", "security", "organization", "team"] as const;
type Tab = (typeof TABS)[number];

const TAB_ICON: Record<Tab, typeof User> = {
  profile: User,
  security: Shield,
  organization: Building2,
  team: UsersRound,
};

/**
 * Every real, functional Settings section in one place (CLAUDE.md §18 — no cosmetic tabs; a
 * setting is only here because a real backend already supports it). Profile and Security are
 * self-service for any signed-in user; Organization and Team are visible to everyone (read-only
 * for non-owners/admins where the underlying form already enforces it) so a member can at least
 * see who else has access and what the organization is — matching `listOrganizationMembers`'s own
 * "any member may view, only owner/admin may change" split.
 *
 * Deliberately absent: Notifications and general "Preferences" (locale/timezone) tabs. Neither has
 * a real backend today — no notification-preferences schema, no per-user locale/timezone column —
 * and CLAUDE.md is explicit that a setting only belongs here once it is functional, never as a
 * clickable-but-dead placeholder (see `components/navigation/UserMenu.tsx`'s own comment to the
 * same effect).
 */
export function SettingsWorkspace() {
  const t = useTranslations("settingsWorkspace");
  const { hasRole } = useSession();
  const isAdmin = hasRole("owner", "admin");
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5 border-b border-hairline pb-3">
        {TABS.map((key) => {
          const Icon = TAB_ICON[key];
          const active = key === tab;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-accent-soft text-accent-foreground"
                  : "text-foreground-secondary hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {t(`tabs.${key}`)}
              {key === "organization" && !isAdmin && (
                <span className="text-2xs text-foreground-muted">{t("readOnlyBadge")}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="max-w-lg">
        {tab === "profile" && <ProfileForm />}
        {tab === "security" && <SecurityAccessForm />}
        {tab === "organization" && <OrganizationForm />}
      </div>
      {tab === "team" && <TeamManagement />}
    </div>
  );
}
