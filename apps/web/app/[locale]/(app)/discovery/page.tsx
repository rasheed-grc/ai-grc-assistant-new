import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/server";
import { getActor } from "@/lib/auth/actor";
import { redirect } from "@/i18n/navigation";
import { DiscoveryFlow } from "@/components/discovery/DiscoveryFlow";
import { getActivePlan } from "@/lib/planExecution/service";
import { findOpenSectorInterview } from "@/lib/sectorInterview/service";
import { UpstreamError } from "@/lib/errors";
import { pageTitle } from "@/lib/pageMetadata";

export async function generateMetadata(): Promise<Metadata> {
  return pageTitle("discoveryInterview.title");
}

/**
 * The single entry point for the whole Discovery -> Report -> Plan journey (Product Flow
 * Simplification): a tenant that already has an active plan is sent straight to `/plan` — this
 * is "I already finished this, take me to my plan," not a second competing starting point.
 * `DiscoveryFlow` itself handles the other resume case (a Mission left awaiting approval).
 *
 * `?restart=1` is the one deliberate escape hatch (linked from `/plan`'s "Run a new assessment")
 * — without it, that link would just bounce straight back here forever.
 */
export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ restart?: string }>;
}) {
  await requireSession();
  const { restart } = await searchParams;
  const actor = await getActor();
  if (actor && !restart) {
    let redirectToPlan = false;
    try {
      // An UNFINISHED sector interview outranks the redirect. Otherwise someone who re-ran their
      // assessment and stopped at the sector questions is bounced to their old plan every time,
      // and the new assessment — holding answers they already gave — becomes unreachable. The
      // redirect exists to stop a finished journey from restarting, not to hide an unfinished one.
      const unfinished = await findOpenSectorInterview(actor);
      const hasUnfinishedSectorStage = unfinished.release !== null && unfinished.sourceSessionId;
      if (!hasUnfinishedSectorStage) {
        redirectToPlan = (await getActivePlan(actor)) !== null;
      }
    } catch (error) {
      // This block only decides whether to SKIP the page; it must never take the page down. The
      // proxied call has already logged the upstream failure, and DiscoveryFlow surfaces a real
      // message if the backend is still unavailable when the customer acts.
      if (!(error instanceof UpstreamError)) throw error;
    }
    if (redirectToPlan) {
      const locale = await getLocale();
      redirect({ href: "/plan", locale });
    }
  }
  const t = await getTranslations("discoveryInterview");

  return (
    <div className="mx-auto max-w-2xl">
      <header className="pb-7">
        <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">
          {t("eyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{t("description")}</p>
      </header>

      <DiscoveryFlow />
    </div>
  );
}
