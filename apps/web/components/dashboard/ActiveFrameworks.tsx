import { ArrowUpRight, Library } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Link } from "@/i18n/navigation";
import { getActor } from "@/lib/auth/actor";
import { computeOrganizationCoverage, type FrameworkCoverage } from "@/lib/governance/coverage";

type FrameworkStatus = "compliant" | "in_progress" | "at_risk";

const statusMeta: Record<FrameworkStatus, { key: string; tone: "success" | "warning" | "danger" }> =
  {
    compliant: { key: "compliant", tone: "success" },
    in_progress: { key: "inProgress", tone: "warning" },
    at_risk: { key: "atRisk", tone: "danger" },
  };

function statusOf(coveragePct: number): FrameworkStatus {
  if (coveragePct >= 80) return "compliant";
  if (coveragePct >= 40) return "in_progress";
  return "at_risk";
}

function FrameworkCard({
  framework,
  t,
}: {
  framework: FrameworkCoverage;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const status = statusMeta[statusOf(framework.coveragePct)];
  const barTone = statusOf(framework.coveragePct) === "compliant" ? "success" : "warning";

  return (
    <Link
      href={`/frameworks/${framework.id}`}
      className="group flex flex-col rounded-2xl border border-hairline bg-surface p-5 shadow-soft transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold tracking-tight text-foreground">
              {framework.shortName}
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-foreground-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </div>
          <p className="mt-1 truncate text-xs text-foreground-muted">{framework.name}</p>
        </div>
        <Badge tone={status.tone} dot>
          {t(`status.${status.key}`)}
        </Badge>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-2xs uppercase tracking-wider text-foreground-muted">
            {t("coverage")}
          </span>
          <span className="font-mono text-sm font-medium tabular-nums text-foreground">
            {framework.coveragePct}%
          </span>
        </div>
        <ProgressBar value={framework.coveragePct} tone={barTone} className="mt-2" />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-2xs text-foreground-muted">
        <span>
          <span className="text-foreground-secondary">{framework.covered}</span> /{" "}
          {framework.total} {t("controls")}
        </span>
        <span>{framework.region}</span>
      </div>
    </Link>
  );
}

export async function ActiveFrameworks() {
  const t = await getTranslations("dashboard.activeFrameworks");
  const actor = await getActor();
  const coverage = actor ? await computeOrganizationCoverage(actor) : null;
  const hasEvidence = (coverage?.overall.evidenceCount ?? 0) > 0;

  return (
    <div>
      <SectionHeader
        title={t("title")}
        description={t("description")}
        action={
          coverage && (
            <Link
              href="/frameworks"
              className="text-2xs font-medium text-accent-foreground hover:underline"
            >
              {t("viewAll", { count: coverage.frameworks.length })}
            </Link>
          )
        }
      />
      {!coverage || !hasEvidence ? (
        <Card grain className="mt-4 flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline-strong bg-surface-elevated">
            <Library className="h-5 w-5 text-foreground-muted" strokeWidth={1.75} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="max-w-xs text-xs text-foreground-muted">{t("emptyDescription")}</p>
          </div>
        </Card>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {coverage.frameworks.map((framework) => (
            <FrameworkCard key={framework.id} framework={framework} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
