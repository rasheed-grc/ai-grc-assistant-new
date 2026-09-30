import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";
import { getActor } from "@/lib/auth/actor";
import { analysisRepository } from "@/lib/analysis/repository";
import { computeOrganizationCoverage } from "@/lib/governance/coverage";
import { listRisks } from "@/lib/risk/service";

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Headline KPIs — every value computed from the tenant's own data (post-v2.0.1 audit;
 * previously a static illustrative dataset with a permanently-fixed "1,248 controls" no
 * tenant ever actually had). No trend arrows: none of these have a historical snapshot to
 * compare against, so none is fabricated. */
export async function StatCards() {
  const t = await getTranslations("dashboard.kpis");
  const actor = await getActor();
  if (!actor) return null;

  const [coverage, risks, analyses] = await Promise.all([
    computeOrganizationCoverage(actor),
    listRisks(actor),
    analysisRepository.listLatestPerDocument(actor.tenantId),
  ]);

  const monthStart = startOfMonth(new Date()).getTime();
  const reviewsThisMonth = analyses.filter(
    (a) => a.status === "processed" && new Date(a.createdAt).getTime() >= monthStart,
  ).length;
  const openRisks = risks.filter((r) => r.status === "open" || r.status === "mitigating").length;

  const kpis = [
    {
      key: "frameworksActive",
      value: String(coverage.frameworks.length),
      sub: t("frameworksActive.sub", { count: coverage.overall.totalControls }),
    },
    {
      key: "controlsMonitored",
      value: coverage.overall.totalControls.toLocaleString(),
      sub: t("controlsMonitored.sub", { pct: coverage.overall.coveragePct }),
    },
    {
      key: "openFindings",
      value: String(coverage.overall.gaps),
      sub: t("openFindings.sub", { count: openRisks }),
    },
    {
      key: "aiReviews",
      value: String(reviewsThisMonth),
      sub: t("aiReviews.sub", { count: analyses.length }),
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <Card key={kpi.key} className="p-4">
          <p className="text-xs text-foreground-muted">{t(`${kpi.key}.label`)}</p>
          <div className="mt-2">
            <span className="font-mono text-xl font-medium tabular-nums tracking-tight text-foreground">
              {kpi.value}
            </span>
          </div>
          <p className="mt-1 text-2xs text-foreground-muted">{kpi.sub}</p>
        </Card>
      ))}
    </div>
  );
}
