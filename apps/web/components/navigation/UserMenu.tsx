"use client";

import { ChevronDown, Loader2, LogOut, Shield, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Popover } from "@/components/ui/Popover";
import { useSession } from "@/components/auth/SessionProvider";
import { primaryRole } from "@/lib/auth/roles";

// "Preferences" is intentionally omitted — there is no preferences backend yet (no
// per-user settings to store), so it stays hidden rather than linking to an empty page
// (post-v2.0.1 audit; CLAUDE.md — no placeholder UI left clickable-but-dead).
const MENU = [
  { key: "profile", icon: User, href: "/profile" },
  { key: "security", icon: Shield, href: "/security-access" },
] as const;

export function UserMenu() {
  const { user, signOut, isSigningOut } = useSession();
  const role = primaryRole(user.roles);
  const t = useTranslations("userMenu");
  const tRoles = useTranslations("teamManagement.roles");
  const roleLabel = tRoles(role ?? "member");

  return (
    <Popover
      width={248}
      ariaLabel={t("menuLabel")}
      trigger={() => (
        <span className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface/60 py-1 ps-1 pe-2 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-accent/40 to-accent/10 text-2xs font-semibold text-accent-foreground">
            {user.initials}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-foreground-muted" strokeWidth={1.75} />
        </span>
      )}
    >
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent/40 to-accent/10 text-xs font-semibold text-accent-foreground">
          {user.initials}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
          <span className="block truncate text-2xs text-foreground-muted">{user.email}</span>
        </span>
      </div>
      <div className="border-b border-hairline px-4 py-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent-foreground">
          {roleLabel}
        </span>
      </div>
      <div className="py-1.5">
        {MENU.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-foreground-secondary transition-colors duration-150 hover:bg-white/[0.03] hover:text-foreground"
            >
              <Icon className="h-4 w-4 text-foreground-muted" strokeWidth={1.75} />
              {t(item.key)}
            </Link>
          );
        })}
      </div>
      <div className="border-t border-hairline py-1.5">
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={isSigningOut}
          className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-foreground-secondary transition-colors duration-150 hover:bg-white/[0.03] hover:text-foreground disabled:opacity-60"
        >
          {isSigningOut ? (
            <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" strokeWidth={1.75} />
          ) : (
            <LogOut className="h-4 w-4 text-foreground-muted" strokeWidth={1.75} />
          )}
          {isSigningOut ? t("signingOut") : t("signOut")}
        </button>
      </div>
    </Popover>
  );
}
