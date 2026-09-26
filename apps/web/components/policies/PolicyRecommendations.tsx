"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  ScrollText,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Badge, type Tone } from "@/components/ui/Badge";
import {
  useDismissRecommendation,
  useDraftFromRecommendation,
  useGenerateRecommendations,
  usePolicyRecommendations,
} from "@/hooks/usePolicyRecommendations";
import type {
  PolicyRecommendation,
  PolicyRecommendationCategory,
  PolicyRecommendationPriority,
} from "@/lib/policyRecommendations/types";
import { cn } from "@/lib/utils";

const PRIORITY_TONE: Record<PolicyRecommendationPriority, Tone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};

const CATEGORY_ORDER: PolicyRecommendationCategory[] = ["establishment", "sector", "general"];

export function PolicyRecommendations() {
  const t = useTranslations("policyRecommendations");
  const { data: recommendations, isLoading, isError } = usePolicyRecommendations();
  const generate = useGenerateRecommendations();

  const pending = (recommendations ?? []).filter((r) => r.status === "pending");
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: pending.filter((r) => r.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <Card flush>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <SectionHeader title={t("title")} description={t("description")} />
        <button
          type="button"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
        >
          {generate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          )}
          {generate.isPending ? t("analyzing") : t("analyze")}
        </button>
      </div>

      <div className="mt-3 px-5 pb-5">
        {generate.isError && (
          <p className="mb-3 flex items-center gap-1.5 text-2xs text-danger">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            {generate.error instanceof Error && generate.error.message.includes("Governance")
              ? t("needsGovernanceProgram")
              : t("analyzeError")}
          </p>
        )}

        {isLoading ? (
          <p className="text-sm text-foreground-muted">{t("loading")}</p>
        ) : isError ? (
          <p className="text-sm text-danger">{t("loadError")}</p>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-hairline-strong bg-surface-2">
              <ScrollText className="h-4 w-4 text-foreground-muted" strokeWidth={1.75} />
            </span>
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="max-w-sm text-xs text-foreground-muted">{t("emptyDescription")}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <div key={group.category}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  {t(`category.${group.category}`)}
                </h3>
                <div className="space-y-2.5">
                  {group.items.map((rec) => (
                    <RecommendationCard key={rec.id} recommendation={rec} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function RecommendationCard({ recommendation }: { recommendation: PolicyRecommendation }) {
  const t = useTranslations("policyRecommendations");
  const [expanded, setExpanded] = useState(false);
  const draft = useDraftFromRecommendation();
  const dismiss = useDismissRecommendation();
  const pending = draft.isPending || dismiss.isPending;

  return (
    <div className="rounded-xl border border-hairline bg-surface-2/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={PRIORITY_TONE[recommendation.priority]}>
          {t(`priority.${recommendation.priority}`)}
        </Badge>
        <Badge tone={recommendation.isRegulatoryRequirement ? "danger" : "neutral"}>
          {recommendation.isRegulatoryRequirement
            ? t("regulatoryRequirement")
            : t("recommendedPractice")}
        </Badge>
      </div>

      <h4 className="mt-2 text-sm font-semibold text-foreground">{recommendation.title}</h4>
      <p className="mt-1 text-sm text-foreground-secondary">{recommendation.reason}</p>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-180")}
          strokeWidth={1.75}
        />
        {expanded ? t("hideDetails") : t("showDetails")}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-hairline pt-3">
          <DetailRow label={t("basis")} value={recommendation.basis} />
          {recommendation.relatedRequirementOrRisk && (
            <DetailRow
              label={t("relatedRequirementOrRisk")}
              value={recommendation.relatedRequirementOrRisk}
            />
          )}
          <DetailRow label={t("practicalGuidance")} value={recommendation.practicalGuidance} />
          <div>
            <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">
              {t("recommendedContents")}
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {recommendation.recommendedContents.map((item) => (
                <li key={item} className="text-sm text-foreground-secondary">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          {recommendation.references.length > 0 && (
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">
                {t("references")}
              </p>
              <p className="mt-1 text-sm text-foreground-secondary">
                {recommendation.references.join(" · ")}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => draft.mutate(recommendation.id)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {draft.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {t("createDraft")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => dismiss.mutate(recommendation.id)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-3 text-xs font-medium text-foreground-secondary transition-colors duration-150 hover:bg-surface-elevated disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("dismiss")}
        </button>
      </div>

      {draft.isSuccess && draft.variables === recommendation.id && (
        <p className="mt-2 text-2xs text-success">
          {t("draftCreated")}{" "}
          <Link href={`/policies?open=${draft.data.policy.id}`} className="underline">
            {t("openDraft")}
          </Link>
        </p>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">{label}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">{value}</p>
    </div>
  );
}
