/**
 * Reporting service — aggregates governance coverage (P7), risks (P8), evidence (P6), and
 * policies (P7) into the three report types. Read-only; requires `read` on `report`.
 * Tenant-scoped. Node-only.
 */

import { getTranslations } from "next-intl/server";
import { ForbiddenError } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import type { ActorContext } from "@/lib/auth/actor";
import { computeCoverage } from "@/lib/governance/coverage";
import { listRisks } from "@/lib/risk/service";
import { toRiskSummary, type Severity } from "@/lib/risk/types";
import { evidenceRepository } from "@/lib/evidence/repository";
import { policyRepository } from "@/lib/policies/repository";
import { POLICY_STATUSES, type Policy } from "@/lib/policies/types";
import { getProgramStatus, type ProgramStatus } from "@/lib/planExecution/programStatus";
import type { PlanDetail, PlanItem, Priority } from "@/lib/planExecution/types";
import { localisedTitle } from "@/lib/planExecution/localiseTitle";
import { documentRepository } from "@/lib/documents/repository";
import type { DocumentRecord } from "@/lib/documents/types";
import { policyRecommendationRepository } from "@/lib/policyRecommendations/repository";
import type { PolicyRecommendation } from "@/lib/policyRecommendations/types";
import type { AppLocale } from "@/i18n/routing";
import { formatReportDate } from "./format";
import { getReportLabels, type ReportLabels } from "./i18n";
import type { Report, ReportKind, ReportSection } from "./types";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function isOpenItem(item: PlanItem): boolean {
  return item.status === "not_started" || item.status === "in_progress";
}

export async function buildReport(
  actor: ActorContext,
  kind: ReportKind,
  locale: AppLocale,
): Promise<Report> {
  if (!can(actor.roles, "read", "report")) {
    throw new ForbiddenError("You are not permitted to view reports.");
  }
  const labels = getReportLabels(locale);
  const meta = labels.meta[kind];
  const base: Omit<Report, "kpis" | "sections"> = {
    kind,
    title: meta.title,
    subtitle: meta.subtitle,
    tenantName: actor.organizationName,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.userName,
  };

  if (kind === "compliance") return { ...base, ...(await complianceContent(actor, labels)) };
  if (kind === "risk") return { ...base, ...(await riskContent(actor, labels)) };
  return { ...base, ...(await executiveContent(actor, labels, locale)) };
}

async function executiveContent(actor: ActorContext, l: ReportLabels, locale: AppLocale) {
  const [coverage, risksRaw, policies, evidenceList, programStatus, documents, recommendations] =
    await Promise.all([
      computeCoverage(actor),
      listRisks(actor),
      policyRepository.list(actor.tenantId),
      evidenceRepository.list(actor.tenantId),
      getProgramStatus(actor),
      documentRepository.list(actor.tenantId),
      policyRecommendationRepository.list(actor.tenantId),
    ]);
  const risks = risksRaw.map(toRiskSummary);
  const evidenceCount = evidenceList.length;

  const critical = risks.filter((r) => r.severity === "critical").length;
  const open = risks.filter((r) => r.status === "open" || r.status === "mitigating").length;
  const published = policies.filter((p) => p.status === "published").length;

  const topRisks = [...risks].sort((a, b) => b.inherentScore - a.inherentScore).slice(0, 5);

  const documentReview = await documentReviewSection(documents, locale, l);
  // Plan items carry a rule-engine key; the stored English title is only the fallback.
  const seed = await getTranslations({ locale, namespace: "planSeed" });
  const titleOf = (item: PlanItem) =>
    localisedTitle(item, (name) => seed.has(name as never), (name) => seed(name as never));
  const references = referencesSection(recommendations, l);

  const sections: ReportSection[] = [
    {
      heading: l.sections.frameworkCoverage,
      table: {
        title: l.tables.frameworkCoverageTitle,
        columns: [l.columns.framework, l.columns.controls, l.columns.covered, l.columns.coverage],
        rows: coverage.frameworks.map((f) => [
          f.shortName,
          String(f.total),
          String(f.covered),
          `${f.coveragePct}%`,
        ]),
      },
    },
    {
      heading: l.sections.topRisks,
      table: {
        title: l.tables.highestScoringRisks,
        columns: [l.columns.risk, l.columns.category, l.columns.score, l.columns.severity, l.columns.status],
        rows: topRisks.map((r) => [
          r.title,
          l.riskCategory[r.category],
          String(r.inherentScore),
          l.severity[r.severity],
          l.riskStatus[r.status],
        ]),
      },
    },
    governanceStatusSection(programStatus, locale, l),
    policyStatusSection(policies, l),
    documentReview,
    actionPlanSection(programStatus.plan, locale, l, titleOf),
    keyFindingsSection(programStatus.plan, l),
    recommendationsSection(recommendations, l),
    nextStepsSection(programStatus, l, titleOf),
    ...(references ? [references] : []),
  ];

  return {
    kpis: [
      { label: l.kpis.complianceCoverage, value: `${coverage.overall.coveragePct}%` },
      { label: l.kpis.controlGaps, value: String(coverage.overall.gaps) },
      { label: l.kpis.openRisks, value: String(open) },
      { label: l.kpis.criticalRisks, value: String(critical) },
      { label: l.kpis.evidenceArtifacts, value: String(evidenceCount) },
      { label: l.kpis.publishedPolicies, value: String(published) },
    ],
    sections,
  };
}

function governanceStatusSection(
  status: ProgramStatus,
  locale: AppLocale,
  l: ReportLabels,
): ReportSection {
  if (status.plan === null) {
    return { heading: l.sections.governanceStatus, narrative: l.governanceNotStarted };
  }
  const items = status.plan.items;
  const done = items.filter((i) => i.status === "done").length;
  const narrative = [
    l.governanceActive(status.version ?? status.plan.plan.version, done, items.length),
    status.state === "reviewDue"
      ? l.governanceReviewDue
      : l.governanceNextReview(formatReportDate(status.reviewDueAt, locale, l.noDueDate)),
  ].join(" ");
  return { heading: l.sections.governanceStatus, narrative };
}

function policyStatusSection(policies: Policy[], l: ReportLabels): ReportSection {
  if (policies.length === 0) {
    return { heading: l.sections.policyStatus, narrative: l.noPolicies };
  }
  const rows = POLICY_STATUSES.map((status) => [
    l.policyStatusLabel[status],
    String(policies.filter((p) => p.status === status).length),
  ]);
  return {
    heading: l.sections.policyStatus,
    table: { title: l.tables.policyStatusTitle, columns: [l.columns.status, l.columns.count], rows },
  };
}

async function documentReviewSection(
  documents: DocumentRecord[],
  locale: AppLocale,
  l: ReportLabels,
): Promise<ReportSection> {
  if (documents.length === 0) {
    return { heading: l.sections.documentReview, narrative: l.noDocuments };
  }
  const [tCategory, tStatus] = await Promise.all([
    getTranslations({ locale, namespace: "documentCategories" }),
    getTranslations({ locale, namespace: "documentStatus" }),
  ]);
  const processed = documents.filter((d) => d.status === "processed").length;
  const rows = documents.slice(0, 20).map((d) => [
    d.fileName,
    tCategory.has(d.category as never) ? tCategory(d.category as never) : d.category,
    tStatus.has(d.status as never) ? tStatus(d.status as never) : d.status,
    formatReportDate(d.createdAt, locale, l.noDueDate),
  ]);
  return {
    heading: l.sections.documentReview,
    narrative: l.documentsSummary(documents.length, processed),
    table: {
      title: l.tables.documentReviewTitle,
      columns: [l.columns.document, l.columns.category, l.columns.status, l.columns.uploadedDate],
      rows,
    },
  };
}

function actionPlanSection(
  plan: PlanDetail | null,
  locale: AppLocale,
  l: ReportLabels,
  titleOf: (item: PlanItem) => string,
): ReportSection {
  if (plan === null) {
    return { heading: l.sections.actionPlan, narrative: l.governanceNotStarted };
  }
  const open = plan.items
    .filter(isOpenItem)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 10);
  if (open.length === 0) {
    return { heading: l.sections.actionPlan, narrative: l.noOpenActionItems };
  }
  const rows = open.map((item) => [
    titleOf(item),
    l.severity[item.priority],
    l.planItemStatus[item.status],
    formatReportDate(item.dueAt, locale, l.noDueDate),
  ]);
  return {
    heading: l.sections.actionPlan,
    table: {
      title: l.tables.actionPlanTitle,
      columns: [l.columns.task, l.columns.priority, l.columns.status, l.columns.dueDate],
      rows,
    },
  };
}

function keyFindingsSection(plan: PlanDetail | null, l: ReportLabels): ReportSection {
  const summary = plan?.plan.executiveSummary ?? null;
  const topRisks = plan?.plan.topRisks ?? [];
  if (!summary && topRisks.length === 0) {
    return { heading: l.sections.keyFindings, narrative: l.noKeyFindings };
  }
  const findingLines = topRisks
    .slice(0, 5)
    .map((r) => {
      const description = typeof r.description === "string" ? r.description : "";
      const severity = typeof r.severity === "string" ? ` (${r.severity})` : "";
      return description ? `- ${description}${severity}` : null;
    })
    .filter((line): line is string => line !== null);
  const narrative = [summary, ...findingLines].filter(Boolean).join("\n");
  return { heading: l.sections.keyFindings, narrative: narrative || l.noKeyFindings };
}

function recommendationsSection(recommendations: PolicyRecommendation[], l: ReportLabels): ReportSection {
  const pending = recommendations.filter((r) => r.status === "pending");
  if (pending.length === 0) {
    return { heading: l.sections.recommendations, narrative: l.noRecommendations };
  }
  const top = [...pending]
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 10);
  const rows = top.map((r) => [
    r.title,
    l.recommendationCategory[r.category],
    l.severity[r.priority],
    r.reason,
  ]);
  return {
    heading: l.sections.recommendations,
    table: {
      title: l.tables.recommendationsTitle,
      columns: [l.columns.recommendation, l.columns.category, l.columns.priority, l.columns.reason],
      rows,
    },
  };
}

function nextStepsSection(
  status: ProgramStatus,
  l: ReportLabels,
  titleOf: (item: PlanItem) => string,
): ReportSection {
  if (status.plan === null) {
    return { heading: l.sections.nextSteps, narrative: l.nextStepsCompleteAssessment };
  }
  const open = status.plan.items
    .filter(isOpenItem)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 3);
  if (open.length === 0) {
    return { heading: l.sections.nextSteps, narrative: l.nextStepsNoneUrgent };
  }
  const lines = open.map((item, index) => `${index + 1}. ${titleOf(item)}`);
  const narrative = [l.nextStepsIntro, ...lines, status.state === "reviewDue" ? l.nextStepsReviewDue : null]
    .filter(Boolean)
    .join("\n");
  return { heading: l.sections.nextSteps, narrative };
}

function referencesSection(
  recommendations: PolicyRecommendation[],
  l: ReportLabels,
): ReportSection | null {
  const refs = new Set<string>();
  for (const r of recommendations) {
    if (r.status !== "pending") continue;
    for (const ref of r.references) refs.add(ref);
  }
  if (refs.size === 0) return null;
  return {
    heading: l.sections.references,
    table: { title: l.tables.referencesTitle, columns: [l.columns.reference], rows: [...refs].map((r) => [r]) },
  };
}

async function complianceContent(actor: ActorContext, l: ReportLabels) {
  const coverage = await computeCoverage(actor);
  const policies = await policyRepository.list(actor.tenantId);

  const gaps = coverage.frameworks.flatMap((f) =>
    f.controls.filter((c) => c.status === "gap").map((c) => [f.shortName, c.code, c.title]),
  );

  return {
    kpis: [
      { label: l.kpis.overallCoverage, value: `${coverage.overall.coveragePct}%` },
      {
        label: l.kpis.controlsCovered,
        value: `${coverage.overall.coveredControls}/${coverage.overall.totalControls}`,
      },
      { label: l.kpis.openGaps, value: String(coverage.overall.gaps) },
      { label: l.kpis.policies, value: String(policies.length) },
    ],
    sections: [
      {
        heading: l.sections.frameworkCoverage,
        table: {
          title: l.tables.frameworkCoverageTitle,
          columns: [l.columns.framework, l.columns.region, l.columns.controls, l.columns.covered, l.columns.coverage],
          rows: coverage.frameworks.map((f) => [
            f.shortName,
            f.region,
            String(f.total),
            String(f.covered),
            `${f.coveragePct}%`,
          ]),
        },
      },
      {
        heading: l.sections.controlGaps,
        narrative: gaps.length === 0 ? l.tables.noControlGaps : undefined,
        table: {
          title: l.tables.controlsWithoutEvidence,
          columns: [l.columns.framework, l.columns.control, l.columns.title],
          rows: gaps,
        },
      },
      {
        heading: l.sections.policyRegister,
        table: {
          title: l.tables.policyRegisterTitle,
          columns: [l.columns.policy, l.columns.status, l.columns.owner, l.columns.mappedControls],
          rows: policies.map((p) => [p.title, p.status, p.ownerName, String(p.controlIds.length)]),
        },
      },
    ],
  };
}

async function riskContent(actor: ActorContext, l: ReportLabels) {
  const risks = (await listRisks(actor)).map(toRiskSummary);

  const bySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byStatus: Record<string, number> = {};
  let scoreSum = 0;
  for (const risk of risks) {
    bySeverity[risk.severity] += 1;
    byStatus[risk.status] = (byStatus[risk.status] ?? 0) + 1;
    scoreSum += risk.inherentScore;
  }
  const avg = risks.length ? Math.round((scoreSum / risks.length) * 10) / 10 : 0;

  return {
    kpis: [
      { label: l.kpis.totalRisks, value: String(risks.length) },
      { label: l.kpis.critical, value: String(bySeverity.critical) },
      { label: l.kpis.high, value: String(bySeverity.high) },
      { label: l.kpis.accepted, value: String(byStatus["accepted"] ?? 0) },
      { label: l.kpis.averageScore, value: String(avg) },
    ],
    sections: [
      {
        heading: l.sections.severityDistribution,
        table: {
          title: l.tables.risksBySeverity,
          columns: [l.columns.severity, l.columns.count],
          rows: SEVERITY_ORDER.map((s) => [l.severity[s], String(bySeverity[s])]),
        },
      },
      {
        heading: l.sections.riskRegister,
        table: {
          title: l.tables.allRisks,
          columns: [
            l.columns.risk,
            l.columns.category,
            l.columns.inherent,
            l.columns.residual,
            l.columns.status,
            l.columns.owner,
          ],
          rows: risks.map((r) => [
            r.title,
            l.riskCategory[r.category],
            `${r.inherentScore} (${l.severity[r.severity]})`,
            r.residualScore != null ? `${r.residualScore} (${l.severity[r.residualSeverity!]})` : "—",
            l.riskStatus[r.status],
            r.ownerName,
          ]),
        },
      },
    ],
  };
}
