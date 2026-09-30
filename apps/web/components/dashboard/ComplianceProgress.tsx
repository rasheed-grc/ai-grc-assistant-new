import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getActor } from "@/lib/auth/actor";
import { computeOrganizationCoverage } from "@/lib/governance/coverage";

const FULL_COVERAGE_TARGET = 100;

/** Real per-framework control coverage (post-v2.0.1 audit; previously a static illustrative
 * dataset). Same organization-scoped source as `ActiveFrameworks`/`StatCards`, so the numbers agree
 * everywhere on the dashboard. No trend indicator: there is no historical
 * coverage snapshot to compare against, so none is fabricated. */
export async function ComplianceProgress() {
  const t = await getTranslations("dashboard.complianceProgress");
  const actor = await getActor();
  if (!actor) return null;

  const coverage = await computeOrganizationCoverage(actor);

  return (
    <Card>
      <SectionHeader
        title={t("title")}
        description={t("description")}
        action={
          <span className="flex items-center gap-1.5 text-2xs text-foreground-muted">
            <span className="h-px w-3 bg-white/30" />
            {t("target")}
          </span>
        }
      />
      {coverage.frameworks.length === 0 && (
        <p className="mt-5 text-xs text-foreground-muted">{t("empty")}</p>
      )}
      <div className="mt-5 space-y-5">
        {coverage.frameworks.map((framework) => {
          const tone =
            framework.coveragePct >= FULL_COVERAGE_TARGET
              ? "success"
              : framework.coveragePct >= 50
                ? "accent"
                : "warning";
          return (
            <div key={framework.id}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground-secondary">
                  {framework.shortName}
                </span>
                <span className="font-mono tabular-nums text-foreground">
                  {framework.coveragePct}
                  <span className="text-foreground-muted"> / {FULL_COVERAGE_TARGET}%</span>
                </span>
              </div>
              <ProgressBar
                value={framework.coveragePct}
                target={FULL_COVERAGE_TARGET}
                tone={tone}
                className="mt-2"
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
