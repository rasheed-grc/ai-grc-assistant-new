"use client";

import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { usePlanItemEvents } from "@/hooks/usePlanExecution";
import { formatCalendarDate } from "@/lib/preferences/format";
import type { AppLocale } from "@/i18n/routing";

/** The audit trail for one item (ADR 0066 §5.3, Phase 3 hardening) — proves a completion has (or
 * doesn't have) a matching event, in the order it actually happened. */
export function ItemHistory({ itemId }: { itemId: string }) {
  const t = useTranslations("planExecution");
  const locale = useLocale() as AppLocale;
  const { data: events, isLoading } = usePlanItemEvents(itemId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-2xs text-foreground-muted">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
        {t("history.loading")}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return <p className="py-2 text-2xs text-foreground-muted">{t("history.empty")}</p>;
  }

  return (
    <ul className="space-y-1.5 rounded-lg bg-surface-elevated px-3 py-2.5">
      {events.map((event) => (
        <li key={event.id} className="flex items-center justify-between gap-3 text-2xs">
          <span className="text-foreground-secondary">
            {t.has(`history.eventType.${event.eventType}` as never)
              ? t(`history.eventType.${event.eventType}` as never)
              : event.eventType}
          </span>
          <span className="text-foreground-muted">
            {formatCalendarDate(new Date(event.createdAt * 1000), locale, {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
