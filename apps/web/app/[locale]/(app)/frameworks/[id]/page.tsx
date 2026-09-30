import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, CheckCircle2, CircleDashed } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { CoverageBar } from "@/components/governance/CoverageBar";
import { LOGIN_PATH } from "@/lib/auth/config";
import { getActor } from "@/lib/auth/actor";
import { computeCoverage, findFrameworkCoverage } from "@/lib/governance/coverage";
import { FRAMEWORKS } from "@/lib/frameworks/catalog";
import { pageTitle } from "@/lib/pageMetadata";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const framework = FRAMEWORKS.find((candidate) => candidate.id === id);
  return framework ? { title: `${framework.shortName} · Rasheed` } : pageTitle("frameworksPage.title");
}

export default async function FrameworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect({ href: LOGIN_PATH, locale: await getLocale() });
  const { id } = await params;
  const report = await computeCoverage(actor);
  const framework = findFrameworkCoverage(report, id);
  if (!framework) notFound();
  const t = await getTranslations("frameworksPage");

  return (
    <div>
      <header className="pb-7">
        <Link
          href="/frameworks"
          className="inline-flex items-center gap-1.5 text-2xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("allFrameworksLink")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          {framework.name}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{framework.region}</p>
        <div className="mt-4 max-w-md">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground-secondary">
              {t("controlsCoveredFraction", { covered: framework.covered, total: framework.total })}
            </span>
            <span className="font-semibold text-foreground">{framework.coveragePct}%</span>
          </div>
          <CoverageBar pct={framework.coveragePct} className="mt-2" />
        </div>
      </header>

      <Card flush>
        <div className="divide-y divide-hairline">
          {framework.controls.map((control) => (
            <div key={control.id} className="flex items-start gap-3 px-5 py-3.5">
              <span className="mt-0.5">
                {control.status === "covered" ? (
                  <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.75} />
                ) : (
                  <CircleDashed className="h-4 w-4 text-foreground-muted" strokeWidth={1.75} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  <span className="font-mono text-foreground-secondary">{control.code}</span> ·{" "}
                  {control.title}
                </p>
                <p className="mt-0.5 text-xs text-foreground-muted">{control.description}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium",
                  control.status === "covered"
                    ? "bg-success-soft text-success"
                    : "bg-white/[0.05] text-foreground-muted",
                )}
              >
                {control.evidenceCount > 0
                  ? t("evidenceCount", { count: control.evidenceCount })
                  : t("statusGap")}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
