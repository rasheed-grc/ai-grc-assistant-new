import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/lib/auth/actor";
import { requireSession } from "@/lib/auth/server";
import { pageTitle } from "@/lib/pageMetadata";
import { Link } from "@/i18n/navigation";
import { getProgramStatus } from "@/lib/planExecution/programStatus";
import { getGovernanceActivity } from "@/lib/planExecution/governanceActivity";
import { getCurrentMaturity } from "@/lib/planExecution/service";
import { ProgramStatus } from "@/components/plan/ProgramStatus";
import { WhatToDoNext } from "@/components/plan/WhatToDoNext";
import { GovernanceActivity } from "@/components/plan/GovernanceActivity";
import { EvidenceCoverage } from "@/components/plan/EvidenceCoverage";
import { MaturityJourney } from "@/components/plan/MaturityJourney";
import { PlanBoard } from "@/components/plan/PlanBoard";
import { Card } from "@/components/ui/Card";
import { TriangleAlert } from "lucide-react";
import { NotFoundError, UpstreamError } from "@/lib/errors";

export async function generateMetadata(): Promise<Metadata> {
  return pageTitle("planExecution.title");
}

/**
 * The Governance Program experience (ADR 0066 §5; CLAUDE.md §3 pillar 10).
 *
 * Five sections, in the order a customer reasons — where am I, where do I stand, what do I do
 * next, what has happened, what can I prove — followed by the plan board itself, which is where
 * the work is actually done.
 *
 * The first thing shown is the program's standing, never a score: a score is not a thing you can
 * act on. And "what to do next" is the largest card on purpose — a customer who opens this page
 * and cannot see their next three steps has been failed by it, however good the rest looks.
 *
 * Scope note: this pillar governs THIS experience. The application's Home Dashboard, the
 * navigation and page names are deliberately untouched by it.
 */
export default async function PlanPage() {
  await requireSession();
  const actor = await getActor();
  if (!actor) redirect("/login");

  const t = await getTranslations("planExecution");
  let loaded;
  try {
    const status = await getProgramStatus(actor);
    loaded =
      status.state === "none" || status.plan === null
        ? { status, activity: null, maturity: null }
        : {
            status,
            ...(await Promise.all([
              getGovernanceActivity(actor, status),
              // The LIVE reading, recalculated as actions complete — not the plan's frozen
              // baseline. The board used to fetch this; moving the section moved the fetch with it.
              getCurrentMaturity(actor),
            ]).then(([activity, maturity]) => ({ activity, maturity }))),
          };
  } catch (error) {
    // grc-api down or misrouted: say so on the page instead of failing the whole route.
    if (!(error instanceof UpstreamError || error instanceof NotFoundError)) throw error;
    const tDiscovery = await getTranslations("discoveryInterview");
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="flex flex-col items-start gap-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            {t("loadError")}
          </p>
          <Link
            href="/plan"
            className="inline-flex h-9 items-center rounded-lg border border-hairline-strong bg-surface-elevated px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-surface-2"
          >
            {tDiscovery("retry")}
          </Link>
        </Card>
      </div>
    );
  }
  const { status, activity, maturity } = loaded;

  // No program yet: the status card is the whole page. `/discovery` is the way in, and sending
  // someone to a plan board with nothing on it would be the same empty dashboard in another shape.
  if (status.state === "none" || status.plan === null) {
    return (
      <div className="mx-auto max-w-4xl">
        <ProgramStatus status={status} />
      </div>
    );
  }

  if (activity === null || maturity === null) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <ProgramStatus status={status} />

      {/* Section 2 — the same component the report uses, so the numbers never disagree. */}
      <MaturityJourney
        baseline={status.plan.plan.maturityBaseline}
        current={maturity.maturity}
      />

      <WhatToDoNext plan={status.plan} />
      <GovernanceActivity events={activity} />
      <EvidenceCoverage actor={actor} />

      {/* The board itself: filtering, grouping, completing, attaching evidence. The sections above
          summarise; this is where the work happens. */}
      <PlanBoard />

      {/* Deliberately low-emphasis and last — re-running discovery supersedes the active plan with
          a new version (ADR 0066 §3.1); it is not the primary action on this page. */}
      <Link
        href="/discovery?restart=1"
        className="inline-block text-xs text-foreground-muted transition-colors duration-150 hover:text-foreground"
      >
        {t("runNewAssessment")}
      </Link>
    </div>
  );
}
