"use client";

import { useTranslations } from "next-intl";
import {
  Check,
  FileText,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { useMission, useMissionResult, useRunMission } from "@/hooks/useMissions";
import { isMissionStatus, type MissionStatus } from "@/lib/missions/types";
import { labelOrIdentifier } from "@/lib/planExecution/labels";
import { cn } from "@/lib/utils";

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

function StepRow({
  index,
  description,
  state,
  summary,
}: {
  index: number;
  description: string;
  state: "done" | "running" | "pending";
  summary?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-hairline py-3 last:border-0">
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold",
          state === "done" && "border-success/30 bg-success/10 text-success",
          state === "running" && "border-accent/40 bg-accent-soft text-accent-foreground",
          state === "pending" && "border-hairline bg-surface-2 text-foreground-muted",
        )}
      >
        {state === "done" ? (
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        ) : state === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
        ) : (
          index + 1
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            state === "pending" ? "text-foreground-muted" : "text-foreground",
          )}
        >
          {description}
        </p>
        {summary && <p className="mt-1 whitespace-pre-wrap text-xs text-foreground-secondary">{summary}</p>}
      </div>
    </div>
  );
}

export function MissionWorkspace({ missionId }: { missionId: string }) {
  const t = useTranslations("missionsPage");
  const { data: mission, isLoading, isError } = useMission(missionId);
  const run = useRunMission(missionId);

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center gap-2 py-12 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        {t("loading")}
      </Card>
    );
  }

  if (isError || !mission) {
    return (
      <Card>
        <div className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{t("loadError")}</span>
        </div>
      </Card>
    );
  }

  const notStarted = mission.status === "created" || mission.status === "planned";
  const isRunning = mission.status === "executing" || mission.status === "resumed";
  const isCompleted = mission.status === "completed";
  const isFailed = mission.status === "failed" || mission.status === "cancelled";
  const tone = isMissionStatus(mission.status) ? STATUS_TONE[mission.status] : "neutral";

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">
              {labelOrIdentifier(t as (key: string) => string, "missionType", mission.type)}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-foreground">
              {mission.scope}
            </h2>
          </div>
          <Badge tone={tone} dot={mission.awaitingApproval}>
            {isMissionStatus(mission.status) ? t(`status.${mission.status}`) : mission.status}
          </Badge>
        </div>

        {notStarted && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-surface/60 px-3.5 py-3">
            <p className="text-xs text-foreground-secondary">
              {t("detail.reviewNotice", { count: mission.plan.length })}
            </p>
            <button
              type="button"
              onClick={() => run.mutate()}
              disabled={run.isPending}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]",
                run.isPending && "opacity-60",
              )}
            >
              {run.isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              {t("detail.executeButton")}
            </button>
          </div>
        )}
        {run.isError && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{run.error instanceof Error ? run.error.message : t("detail.executeError")}</span>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-sm font-semibold text-foreground">{t("detail.planHeading")}</h3>
        <p className="mb-3 text-xs text-foreground-secondary">
          {notStarted
            ? t("detail.planSubtitleReview")
            : isRunning
              ? t("detail.planSubtitleRunning")
              : t("detail.planSubtitleDone")}
        </p>
        <div>
          {mission.plan.map((step, index) => {
            const finding = mission.findings[index];
            const state: "done" | "running" | "pending" = finding
              ? "done"
              : isRunning && index === mission.findings.length
                ? "running"
                : "pending";
            return (
              <StepRow
                key={step.id}
                index={index}
                description={step.description}
                state={state}
                summary={finding?.summary}
              />
            );
          })}
        </div>
      </Card>

      {isFailed && (
        <Card className="border-danger/30">
          <div className="flex items-start gap-2 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
            <div>
              <p className="font-medium text-foreground">{t("detail.failedTitle")}</p>
              <p className="mt-0.5 text-xs text-foreground-secondary">{t("detail.failedBody")}</p>
            </div>
          </div>
        </Card>
      )}

      {isCompleted && <MissionResultCard missionId={missionId} />}
    </div>
  );
}

function MissionResultCard({ missionId }: { missionId: string }) {
  const t = useTranslations("missionsPage.detail");
  const { data: result, isLoading, isError } = useMissionResult(missionId, true);

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center gap-2 py-10 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        {t("resultLoading")}
      </Card>
    );
  }

  if (isError || !result) {
    return (
      <Card>
        <div className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{t("resultLoadError")}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-foreground-muted" strokeWidth={1.75} />
        <h3 className="text-sm font-semibold text-foreground">{t("resultHeading")}</h3>
      </div>

      {/* Trust bar — evidence-first, shown before any narrative content. */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-hairline bg-surface/60 px-3.5 py-3">
        <div className="flex items-center gap-1.5 text-xs text-foreground-secondary">
          <ShieldCheck className="h-3.5 w-3.5 text-foreground-muted" strokeWidth={1.75} />
          {t("trust.evidence", { count: result.evidenceCount })}
        </div>
        <div className="text-xs text-foreground-secondary">
          {t("trust.humanReview")}: {result.humanReview}
        </div>
      </div>

      {result.coverage && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground-secondary">
              {t("coverage.title", { framework: result.coverage.framework })}
            </p>
            <p className="text-sm font-semibold text-accent-foreground">
              {Math.round(result.coverage.coverage * 100)}%
            </p>
          </div>
          {result.coverage.gaps.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-start text-2xs uppercase tracking-wider text-foreground-muted">
                    <th className="px-3 py-2 font-medium">{t("coverage.control")}</th>
                    <th className="px-3 py-2 font-medium">{t("coverage.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.coverage.gaps.map((gap) => (
                    <tr key={gap.controlCode} className="border-b border-hairline last:border-0">
                      <td className="px-3 py-2 text-foreground-secondary">
                        {gap.controlCode} {gap.controlTitle}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={gap.covered ? "success" : "danger"}>
                          {gap.covered ? t("coverage.covered") : t("coverage.gap")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {result.sections.map((section, i) => (
          <div key={i}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {section.heading}
            </h4>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground-secondary">
              {section.body}
            </p>
            {section.citations.length > 0 && (
              <p className="mt-1.5 text-2xs text-foreground-muted">
                {t("citations")}: {section.citations.join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
