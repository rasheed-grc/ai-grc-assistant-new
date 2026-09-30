"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Link } from "@/i18n/navigation";
import { useActivePlan } from "@/hooks/usePlanExecution";
import { PlanStats } from "./PlanStats";
import { PlanItemCard } from "./PlanItemCard";
import { VersionHistory } from "./VersionHistory";
import { labelOrIdentifier } from "@/lib/planExecution/labels";
import { groupItems, type GroupBy } from "@/lib/planExecution/grouping";
import type { PlanItemStatus } from "@/lib/planExecution/types";
import { formatCalendarDate } from "@/lib/preferences/format";
import type { AppLocale } from "@/i18n/routing";

type StatusFilter = "all" | PlanItemStatus;

export function PlanBoard() {
  const t = useTranslations("planExecution");
  const locale = useLocale() as AppLocale;
  const { data: detail, isLoading, isError } = useActivePlan();
  const [groupBy, setGroupBy] = useState<GroupBy>("timeline");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filteredItems = useMemo(() => {
    if (!detail) return [];
    return statusFilter === "all" ? detail.items : detail.items.filter((item) => item.status === statusFilter);
  }, [detail, statusFilter]);

  const grouped = useMemo(() => groupItems(filteredItems, groupBy), [filteredItems, groupBy]);

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center gap-2 py-16 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        {t("loading")}
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <div className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{t("loadError")}</span>
        </div>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card grain className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline-strong bg-surface-elevated shadow-soft">
          <Sparkles className="h-5 w-5 text-accent-foreground" strokeWidth={1.75} />
        </div>
        <div className="max-w-md space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t("empty.title")}</p>
          <p className="text-xs text-foreground-muted">{t("empty.description")}</p>
        </div>
        <Link
          href="/discovery"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]"
        >
          {t("empty.cta")}
        </Link>
      </Card>
    );
  }

  const { plan, items } = detail;

  return (
    <div className="space-y-5">
      <Card grain>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone="accent">{t("planVersion", { version: plan.version })}</Badge>
          {plan.createdAt && (
            <span className="text-2xs text-foreground-muted">
              {formatCalendarDate(new Date(plan.createdAt * 1000), locale, {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        {plan.executiveSummary && (
          <p className="mt-3 text-sm leading-relaxed text-foreground-secondary">{plan.executiveSummary}</p>
        )}
      </Card>

      {/* Maturity and the next actions moved ABOVE this board (page.tsx, sections 2 and 3): they
          answer "where do I stand" and "what do I do next", which a customer needs before the
          board's filters. Quick wins went with them — the badge is on the action itself now, and
          starting one still happens on its own card below. */}
      <PlanStats items={items} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
          {t("groupBy.label")}
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="h-8 rounded-lg border border-hairline bg-surface px-2 text-xs text-foreground-secondary outline-none focus:border-hairline-strong"
          >
            <option value="timeline">{t("groupBy.timeline")}</option>
            <option value="priority">{t("groupBy.priority")}</option>
            <option value="pillar">{t("groupBy.pillar")}</option>
          </select>
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-8 rounded-lg border border-hairline bg-surface px-2 text-xs text-foreground-secondary outline-none focus:border-hairline-strong"
        >
          <option value="all">{t("statusFilter.all")}</option>
          <option value="not_started">{t("statusFilter.not_started")}</option>
          <option value="in_progress">{t("statusFilter.in_progress")}</option>
          <option value="done">{t("statusFilter.done")}</option>
        </select>
      </div>

      {grouped.length === 0 ? (
        <Card className="py-10 text-center text-sm text-foreground-muted">{t("noItemsForFilter")}</Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([key, groupItemsList]) => (
            <div key={key}>
              <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                {/* The group key comes from persisted plan data, so it degrades rather than
                    throws — the same reason `PlanItemCard` does. */}
                {labelOrIdentifier(
                  t as (key: string) => string,
                  groupBy === "timeline" ? "timeframe" : groupBy === "priority" ? "priority" : "pillar",
                  key,
                )}
                <span className="ms-1.5 font-normal normal-case text-foreground-muted">
                  ({groupItemsList.length})
                </span>
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {groupItemsList.map((item) => (
                  <PlanItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <VersionHistory />
    </div>
  );
}
