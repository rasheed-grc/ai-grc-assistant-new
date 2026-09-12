"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { localisedTitle } from "@/lib/planExecution/localiseTitle";
import {
  AlertTriangle,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDot,
  Loader2,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { EvidenceModal } from "./EvidenceModal";
import { ItemHistory } from "./ItemHistory";
import {
  useCompletePlanItem,
  useReopenPlanItem,
  useStartPlanItem,
} from "@/hooks/usePlanExecution";
import { labelOrIdentifier } from "@/lib/planExecution/labels";
import { PlanActionError } from "@/lib/planExecution/client";
import type { PlanItem, PlanItemStatus, Priority } from "@/lib/planExecution/types";
import { cn } from "@/lib/utils";

const PRIORITY_TONE: Record<Priority, Tone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};

const STATUS_STEPS: PlanItemStatus[] = ["not_started", "in_progress", "done"];

/**
 * What to tell someone whose action did not apply.
 *
 * Only `409` means "someone else changed this". Every other failure has its own cause, and
 * reporting them all as a conflict points the reader at a phantom edit instead of the real
 * problem — a mistake this screen made until an optimistic-lock bug turned every transition into
 * a 409 and the copy dutifully lied about why.
 */
function failureKey(error: Error): string {
  const status = error instanceof PlanActionError ? error.status : 0;
  if (status === 409) return "item.conflict";
  if (status === 401 || status === 403) return "item.notPermitted";
  if (status === 404) return "item.missing";
  return "item.actionFailed";
}

function dueMeta(dueAt: number | null): { key: string; values?: Record<string, number>; tone: Tone } | null {
  if (dueAt == null) return null;
  const diffDays = Math.ceil((dueAt * 1000 - Date.now()) / 86_400_000);
  if (diffDays < 0) return { key: "item.overdueBy", values: { days: Math.abs(diffDays) }, tone: "danger" };
  if (diffDays === 0) return { key: "item.dueToday", tone: "warning" };
  return { key: "item.dueIn", values: { days: diffDays }, tone: "neutral" };
}

interface PlanItemCardProps {
  item: PlanItem;
}

export function PlanItemCard({ item }: PlanItemCardProps) {
  const t = useTranslations("planExecution");
  // A separate namespace, because these names are the RULE ENGINE's vocabulary, not this
  // component's. `has` is asked first: next-intl answers a missing message with the
  // namespace-qualified key rather than throwing, and `planSeed.foo` on a customer's screen is
  // worse than the English the plan already stored.
  const seed = useTranslations("planSeed");
  // Same `has`-guarded pattern for traceability: `item.sourceSignalKeys` is Discovery's internal
  // signal vocabulary, not question text. Only keys with a known `discovery.question.<key>` label
  // resolve to something shown — an unrecognized key (e.g. a sector-pack signal with no fixed
  // label) is dropped rather than ever rendering raw jargon.
  const discovery = useTranslations("discovery");
  const sourceLabels = item.sourceSignalKeys
    .filter((key) => discovery.has(`question.${key}` as never))
    .map((key) => discovery(`question.${key}` as never));
  const [expanded, setExpanded] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const start = useStartPlanItem();
  const complete = useCompletePlanItem();
  const reopen = useReopenPlanItem();
  const pending = start.isPending || complete.isPending || reopen.isPending;
  const failure = start.error ?? complete.error ?? reopen.error;

  const due = dueMeta(item.dueAt);
  const stepIndex = STATUS_STEPS.indexOf(item.status === "not_applicable" || item.status === "deferred" ? "not_started" : item.status);

  return (
    <Card className={cn("transition-opacity", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{labelOrIdentifier(t as (key: string) => string, "pillar", item.pillar)}</Badge>
        <Badge tone={PRIORITY_TONE[item.priority]}>{t(`priority.${item.priority}` as never)}</Badge>
        <Badge tone="neutral">{t(`timeframe.${item.timeframeBucket}` as never)}</Badge>
        {item.confidence != null && (
          <span className="ms-auto text-2xs text-foreground-muted">
            {t("item.confidence", { value: Math.round(item.confidence * 100) })}
          </span>
        )}
      </div>

      <h3 className="mt-2.5 text-sm font-semibold leading-snug text-foreground">
        {localisedTitle(item, seed.has, seed)}
      </h3>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <StatusStepper
          item={item}
          stepIndex={stepIndex}
          pending={pending}
          onStart={() => start.mutate(item.id)}
          onComplete={() => complete.mutate(item.id)}
          onReopen={() => reopen.mutate(item.id)}
        />
        {due && (
          <span
            className={cn(
              "text-2xs font-medium",
              due.tone === "danger" && "text-danger",
              due.tone === "warning" && "text-warning",
              due.tone === "neutral" && "text-foreground-muted",
            )}
          >
            {(t as (key: string, values?: Record<string, number>) => string)(due.key, due.values)}
          </span>
        )}
      </div>

      {failure && (
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
          {(t as (key: string) => string)(failureKey(failure))}
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-180")}
          strokeWidth={1.75}
        />
        {expanded ? t("item.hideDetails") : t("item.showDetails")}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-hairline pt-3">
          <DetailRow label={t("item.why")} value={item.rationale} />
          <DetailRow label={t("item.expectedOutcome")} value={item.expectedOutcome} />
          {item.riskIfSkipped && <DetailRow label={t("item.ifIgnored")} value={item.riskIfSkipped} tone="danger" />}
          {sourceLabels.length > 0 && (
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">
                {t("item.source")}
              </p>
              <ul className="mt-1 space-y-1">
                {sourceLabels.map((label) => (
                  <li key={label} className="text-sm leading-relaxed text-foreground-secondary">
                    &ldquo;{label}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              {item.isEvidenceBacked ? (
                <Badge tone="success" dot>
                  {t("item.evidenceBacked")}
                </Badge>
              ) : item.status === "done" ? (
                <Badge tone="neutral">{t("item.reportedBy")}</Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="text-2xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground"
              >
                {t("item.viewHistory")}
              </button>
              <button
                type="button"
                onClick={() => setEvidenceOpen(true)}
                className="inline-flex items-center gap-1 text-2xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground"
              >
                <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                {t("item.attachEvidence")}
              </button>
            </div>
          </div>

          {historyOpen && <ItemHistory itemId={item.id} />}
        </div>
      )}

      {evidenceOpen && (
        <EvidenceModal
          item={item}
          onClose={() => setEvidenceOpen(false)}
        />
      )}
    </Card>
  );
}

function DetailRow({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">{label}</p>
      <p className={cn("mt-0.5 text-sm leading-relaxed", tone === "danger" ? "text-danger" : "text-foreground-secondary")}>
        {value}
      </p>
    </div>
  );
}

function StatusStepper({
  item,
  stepIndex,
  pending,
  onStart,
  onComplete,
  onReopen,
}: {
  item: PlanItem;
  stepIndex: number;
  pending: boolean;
  onStart: () => void;
  onComplete: () => void;
  onReopen: () => void;
}) {
  const t = useTranslations("planExecution");

  if (item.status === "done") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
          <CircleCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("status.done")}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={onReopen}
          className="inline-flex items-center gap-1 text-2xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          ) : (
            <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
          )}
          {t("item.reopen")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <StepPill icon={Circle} label={t("status.not_started")} active={stepIndex === 0} />
      <StepConnector filled={stepIndex >= 1} />
      <button
        type="button"
        disabled={pending || stepIndex >= 1}
        onClick={onStart}
        className="disabled:cursor-default"
      >
        <StepPill
          icon={CircleDot}
          label={t("status.in_progress")}
          active={stepIndex === 1}
          interactive={stepIndex === 0}
        />
      </button>
      <StepConnector filled={false} />
      <button type="button" disabled={pending} onClick={onComplete} className="disabled:opacity-60">
        <StepPill icon={CircleCheck} label={t("item.markComplete")} active={false} interactive />
      </button>
    </div>
  );
}

function StepPill({
  icon: Icon,
  label,
  active,
  interactive = false,
}: {
  icon: typeof Circle;
  label: string;
  active: boolean;
  interactive?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150",
        active
          ? "bg-accent-soft text-accent-foreground"
          : interactive
            ? "border border-hairline-strong bg-surface text-foreground-secondary hover:bg-surface-elevated"
            : "text-foreground-muted",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
    </span>
  );
}

function StepConnector({ filled }: { filled: boolean }) {
  return <span className={cn("h-px w-3", filled ? "bg-accent/40" : "bg-hairline")} />;
}
