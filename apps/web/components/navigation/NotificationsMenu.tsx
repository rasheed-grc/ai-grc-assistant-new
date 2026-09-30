"use client";

import { Bell, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Popover } from "@/components/ui/Popover";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { useMarkNotificationsRead, useNotifications, usePreferences } from "@/hooks/usePreferences";
import { formatRelativeTime } from "@/lib/dashboard/relativeTime";
import { formatDateTimeInZone } from "@/lib/preferences/format";
import { labelOrIdentifier } from "@/lib/planExecution/labels";
import { cn } from "@/lib/utils";

/**
 * The bell. Everything in it is derived server-side from real records (missions waiting for the
 * caller's approval, recent mission failures, open team invitations) — see
 * `lib/preferences/service.ts`. Categories can be switched off in Settings > Preferences.
 */
export function NotificationsMenu() {
  const t = useTranslations("notifications");
  const tMission = useTranslations("missionsPage");
  const locale = useLocale() as AppLocale;
  const { data, isLoading, isError } = useNotifications();
  const { data: prefs } = usePreferences();
  const markRead = useMarkNotificationsRead();
  const unread = data?.unreadCount ?? 0;

  return (
    <Popover
      width={340}
      ariaLabel={unread > 0 ? t("menuLabelUnread", { count: unread }) : t("menuLabel")}
      onOpenChange={(open) => {
        // Opening the bell is what "seeing" them means; the badge clears on the next poll.
        if (open && unread > 0) markRead.mutate();
      }}
      trigger={() => (
        <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface/60 text-foreground-secondary transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2 hover:text-foreground">
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      )}
    >
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{t("title")}</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center px-4 py-8">
          <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" strokeWidth={2} />
        </div>
      ) : isError ? (
        <p className="px-4 py-8 text-center text-xs text-danger">{t("loadError")}</p>
      ) : data && data.items.length > 0 ? (
        <ul className="max-h-96 divide-y divide-hairline overflow-y-auto">
          {data.items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className={cn(
                  "block px-4 py-3 transition-colors hover:bg-surface-2",
                  item.unread && "bg-accent-soft/40",
                )}
              >
                <p className="text-sm text-foreground">{t(`category.${item.category}`)}</p>
                <p className="mt-0.5 truncate text-xs text-foreground-secondary">
                  {item.missionType
                    ? `${labelOrIdentifier(tMission as (key: string) => string, "missionType", item.missionType)} · `
                    : ""}
                  {item.subject}
                </p>
                <p
                  className="mt-0.5 text-2xs text-foreground-muted"
                  title={formatDateTimeInZone(item.at, prefs?.timezone ?? "Asia/Riyadh", locale)}
                >
                  {formatRelativeTime(item.at, locale)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Bell className="h-5 w-5 text-foreground-muted" strokeWidth={1.75} />
          <p className="text-xs text-foreground-muted">{t("empty")}</p>
        </div>
      )}
    </Popover>
  );
}
