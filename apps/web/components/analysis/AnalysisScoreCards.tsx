"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck, TriangleAlert, Gauge } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScoreRing } from "@/components/ui/ScoreRing";
import type { AnalysisFinding, Severity } from "@/lib/analysis/types";
import { MATURITY_LEVELS, type MaturityLevel } from "@/lib/analysis/scoring/types";
import { cn } from "@/lib/utils";

const SEVERITY_TONE: Record<Severity, "danger" | "warning" | "accent" | "neutral"> = {
  high: "danger",
  medium: "warning",
  low: "accent",
  info: "neutral",
};

interface AnalysisScoreCardsProps {
  complianceScore?: number;
  riskScore?: number;
  maturityLevel?: string;
  findings: AnalysisFinding[];
}

/** Deterministically computed scores (lib/analysis/scoring) — never asked of the model. */
export function AnalysisScoreCards({
  complianceScore,
  riskScore,
  maturityLevel,
  findings,
}: AnalysisScoreCardsProps) {
  const t = useTranslations("analysisScoreCards");
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="flex flex-col items-center gap-3 text-center">
        <ScoreRing
          value={complianceScore ?? 0}
          tone="success"
          size={104}
          caption={t("compliance")}
        />
        <p className="text-xs text-foreground-muted">{t("weightedAcrossFrameworks")}</p>
      </Card>

      <Card className="flex flex-col items-center gap-3 text-center">
        <ScoreRing value={riskScore ?? 0} tone="danger" size={104} caption={t("risk")} />
        {maturityLevel && (
          <Badge tone="accent">
            <Gauge className="h-3 w-3" strokeWidth={2} />
            {t("maturityLevel", {
              level: (MATURITY_LEVELS as readonly string[]).includes(maturityLevel)
                ? t(`maturityLevels.${maturityLevel as MaturityLevel}`)
                : maturityLevel,
            })}
          </Badge>
        )}
      </Card>

      <Card className="flex flex-col justify-center gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-foreground-secondary" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{t("findings")}</h3>
          <span className="ms-auto text-lg font-semibold tracking-tight text-foreground">
            {findings.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {(Object.keys(counts) as Severity[])
            .filter((severity) => counts[severity] > 0)
            .map((severity) => (
              <div key={severity} className="flex items-center justify-between text-xs">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    severity === "high" ? "text-danger" : "text-foreground-secondary",
                  )}
                >
                  <TriangleAlert className="h-3 w-3" strokeWidth={2} />
                  {t(`severity.${severity}`)}
                </span>
                <Badge tone={SEVERITY_TONE[severity]}>{counts[severity]}</Badge>
              </div>
            ))}
          {findings.length === 0 && (
            <p className="text-xs text-foreground-muted">{t("noFindings")}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
