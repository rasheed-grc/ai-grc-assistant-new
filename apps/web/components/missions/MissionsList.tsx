"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Loader2, TriangleAlert, Workflow } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Link } from "@/i18n/navigation";
import { useMissions } from "@/hooks/useMissions";
import { formatRelativeTime } from "@/lib/dashboard/relativeTime";
import type { AppLocale } from "@/i18n/routing";
import { isMissionStatus, type Mission, type MissionStatus } from "@/lib/missions/types";
import { labelOrIdentifier } from "@/lib/planExecution/labels";

const STATUS_TONE: Record<MissionStatus, Tone> = {
  created: "neutral",
  planned: "neutral",
  executing: "accent",
  awaiting_approval: "warning",
  resumed: "accent",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  archived: "neutral",
};

function StatusBadge({ status, awaitingApproval }: { status: string; awaitingApproval: boolean }) {
  const t = useTranslations("missionsPage");
  // One vocabulary: `awaitingApproval` IS `status === "awaiting_approval"`, so the badge reads the
  // status and the flag only decides emphasis. A second label for the same fact is how the two
  // drift apart.
  const tone = isMissionStatus(status) ? STATUS_TONE[status] : "neutral";
  const label = isMissionStatus(status) ? t(`status.${status}`) : status;
  return (
    <Badge tone={tone} dot={awaitingApproval}>
      {label}
    </Badge>
  );
}

/**
 * An opaque identifier is not a subject.
 *
 * The engine's list carries the mission's `scope`, which for most types is the thing it ran
 * against ("Technological controls") and is worth showing. For a governance plan the scope is the
 * discovery session id — load-bearing for the mission, meaningless to the person reading the row.
 * Rather than teach this component about mission types, it hides what it can see is an id.
 */
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{24,}$/i;

function subjectOf(mission: Mission): string | null {
  const scope = mission.scope.trim();
  return scope && !OPAQUE_ID.test(scope) ? scope : null;
}

function MissionRow({ mission }: { mission: Mission }) {
  const t = useTranslations("missionsPage");
  const locale = useLocale() as AppLocale;
  return (
    <tr className="border-b border-hairline transition-colors duration-150 last:border-0 hover:bg-surface-2/60">
      <td className="p-0">
        <Link href={`/missions/${mission.id}`} className="block px-5 py-3">
          {/* The mission TYPE is the headline — "Governance Plan", not an id. An unlabelled type
              degrades to a readable identifier rather than throwing: mission types come from the
              engine's catalog, which can grow without this interface knowing. */}
          <p className="truncate font-medium text-foreground">
            {labelOrIdentifier(t as (key: string) => string, "missionType", mission.type)}
          </p>
          {subjectOf(mission) && (
            <p className="mt-0.5 truncate text-2xs text-foreground-muted">{subjectOf(mission)}</p>
          )}
        </Link>
      </td>
      <td className="p-0">
        <Link href={`/missions/${mission.id}`} className="block px-3 py-3">
          <StatusBadge status={mission.status} awaitingApproval={mission.awaitingApproval} />
        </Link>
      </td>
      <td className="p-0">
        <Link
          href={`/missions/${mission.id}`}
          className="block px-3 py-3 text-foreground-secondary"
        >
          {formatRelativeTime(mission.updatedAt, locale)}
        </Link>
      </td>
    </tr>
  );
}

export function MissionsList() {
  const t = useTranslations("missionsPage");
  const { data: missions, isLoading, isError } = useMissions();

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center gap-2 py-12 text-sm text-foreground-muted">
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

  if (!missions || missions.length === 0) {
    return (
      <Card grain className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline-strong bg-surface-2 shadow-soft">
          <Workflow className="h-5 w-5 text-accent-foreground" strokeWidth={1.75} />
        </div>
        <div className="max-w-sm space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t("emptyState.title")}</p>
          <p className="text-xs text-foreground-muted">{t("emptyState.description")}</p>
        </div>
        <Link
          href="/discovery"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]"
        >
          {t("emptyState.cta")}
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Link>
      </Card>
    );
  }

  return (
    <Card flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-start text-2xs uppercase tracking-wider text-foreground-muted">
              {/* Three columns, not five. The engine's list projection carries no step count and
                  no owner name, and a permanently empty column tells a customer less than one that
                  is not there. */}
              <th className="px-5 py-2.5 font-medium">{t("table.mission")}</th>
              <th className="px-3 py-2.5 font-medium">{t("table.status")}</th>
              <th className="px-3 py-2.5 font-medium">{t("table.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {missions.map((mission) => (
              <MissionRow key={mission.id} mission={mission} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
