"use client";

import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, ListChecks, Target, Zap } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { labelOrIdentifier } from "@/lib/planExecution/labels";
import { localisedTitle } from "@/lib/planExecution/localiseTitle";
import { groupItems, isQuickWin } from "@/lib/planExecution/grouping";
import type { Priority } from "@/lib/planExecution/types";
import type { GovernanceReportItem } from "@/lib/planGeneration/types";
import { formatCalendarDate } from "@/lib/preferences/format";
import type { AppLocale } from "@/i18n/routing";

const PRIORITY_TONE: Record<Priority, Tone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};

function dueDate(dueAt: number | null, locale: AppLocale): string | null {
  if (dueAt == null) return null;
  return formatCalendarDate(new Date(dueAt * 1000), locale);
}

/** Section 5 (ADR 0066 §4): small effort, high/critical urgency — no new logic, the same filter
 * the live Plan Board's Quick Wins strip uses, so what a client is told they "can start
 * immediately" here is exactly what they'll see as a Quick Win once the plan is active. */
export function QuickWinsSection({ items }: { items: GovernanceReportItem[] }) {
  const t = useTranslations("governanceReport");
  const seed = useTranslations("planSeed");
  const wins = items.filter(isQuickWin);
  if (wins.length === 0) return null;
  return (
    <Card grain>
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-accent-foreground" strokeWidth={1.75} />
        <h3 className="text-sm font-medium text-foreground">{t("quickWins.title")}</h3>
      </div>
      <ul className="space-y-2">
        {wins.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3.5 py-2 text-sm"
          >
            <span className="text-foreground-secondary">{localisedTitle(item, seed.has, seed)}</span>
            <Badge tone="neutral">{labelOrIdentifier(t as (key: string) => string, "pillar", item.pillar)}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Section 6: the same scheduled items as an overview grouped by priority, before the time-based
 * view (section 7) — an at-a-glance "what matters most" read. */
export function PriorityRoadmapSection({ items }: { items: GovernanceReportItem[] }) {
  const t = useTranslations("governanceReport");
  const seed = useTranslations("planSeed");
  const grouped = groupItems(items, "priority");
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-accent-foreground" strokeWidth={1.75} />
        <h3 className="text-sm font-medium text-foreground">{t("priorityRoadmap.title")}</h3>
      </div>
      <div className="space-y-4">
        {grouped.map(([priority, group]) => (
          <div key={priority}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Badge tone={PRIORITY_TONE[priority as Priority]}>{t(`priority.${priority}` as never)}</Badge>
              <span className="text-2xs text-foreground-muted">({group.length})</span>
            </div>
            <ul className="space-y-1.5 ps-1">
              {group.map((item) => (
                <li key={item.id} className="text-sm text-foreground-secondary">
                  {localisedTitle(item, seed.has, seed)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Section 7: the six-period schedule (ADR 0066 §2.5's deterministic, capacity-aware scheduler —
 * never an LLM decision). */
export function TimelineSection({ items }: { items: GovernanceReportItem[] }) {
  const t = useTranslations("governanceReport");
  const seed = useTranslations("planSeed");
  const grouped = groupItems(items, "timeline");
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-accent-foreground" strokeWidth={1.75} />
        <h3 className="text-sm font-medium text-foreground">{t("timeline.title")}</h3>
      </div>
      <div className="space-y-4">
        {grouped.map(([bucket, group]) => (
          <div key={bucket}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wider text-foreground-muted">
                {t(`timeframe.${bucket}` as never)}
              </span>
              <span className="text-2xs text-foreground-muted">({group.length})</span>
            </div>
            <ul className="space-y-1.5 ps-1">
              {group.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <Badge tone={PRIORITY_TONE[item.priority]} className="shrink-0">
                    {t(`priority.${item.priority}` as never)}
                  </Badge>
                  {localisedTitle(item, seed.has, seed)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Section 8: the full, tailored recommendations — every item's rationale/expected-outcome/
 * risk-if-skipped, exactly what makes this a plan and not a checklist (ADR 0066 §5.2). Read-only:
 * nothing is persisted until Approve & Activate — the interactive status stepper only exists on
 * the live Plan (`components/plan/PlanItemCard.tsx`), once this content is real. */
export function ActionTasksSection({ items }: { items: GovernanceReportItem[] }) {
  const t = useTranslations("governanceReport");
  const seed = useTranslations("planSeed");
  const locale = useLocale() as AppLocale;
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-accent-foreground" strokeWidth={1.75} />
        <h3 className="text-sm font-medium text-foreground">{t("actionTasks.title")}</h3>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => {
          const due = dueDate(item.dueAt, locale);
          return (
            <div key={item.id} className="rounded-lg border border-hairline p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">{labelOrIdentifier(t as (key: string) => string, "pillar", item.pillar)}</Badge>
                <Badge tone={PRIORITY_TONE[item.priority]}>{t(`priority.${item.priority}` as never)}</Badge>
                <Badge tone="neutral">{t(`timeframe.${item.timeframeBucket}` as never)}</Badge>
                {item.confidence != null && (
                  <span className="ms-auto text-2xs text-foreground-muted">
                    {t("actionTasks.confidence", { value: Math.round(item.confidence * 100) })}
                  </span>
                )}
              </div>
              <h4 className="mt-2 text-sm font-semibold leading-snug text-foreground">{localisedTitle(item, seed.has, seed)}</h4>
              <p className="mt-1.5 text-sm text-foreground-secondary">{item.rationale}</p>
              <p className="mt-1.5 text-2xs text-foreground-muted">
                <span className="font-medium text-foreground-secondary">{t("actionTasks.outcome")}: </span>
                {item.expectedOutcome}
              </p>
              {due && (
                <p className="mt-1.5 text-2xs text-foreground-muted">
                  {t("actionTasks.due", { date: due })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
