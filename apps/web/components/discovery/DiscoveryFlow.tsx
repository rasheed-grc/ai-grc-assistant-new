"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Compass, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { AnswerInput } from "./AnswerInput";
import { StageProgress } from "./StageProgress";
import { JourneyStepper } from "@/components/governance/JourneyStepper";
import { GovernanceReport } from "@/components/governance/GovernanceReport";
import { SectorQuestions } from "./SectorQuestions";
import { findOpenSectorInterview, openSectorInterview } from "@/lib/sectorInterview/client";
import type { SectorInterview } from "@/lib/sectorInterview/types";
import { useSession } from "@/components/auth/SessionProvider";
import { useRouter } from "@/i18n/navigation";
import { APPROVER_ROLES } from "@/lib/planGeneration/permissions";
import type { DiscoveryProgress, DiscoveryQuestion } from "@/lib/discovery/types";
import type { GovernanceReportDraft } from "@/lib/planGeneration/types";

type Phase =
  | "loading"
  | "idle"
  | "interviewing"
  // The sector stage: the questions a reviewer activated for this organization's sector. Between
  // the core interview and the plan, because the plan is built from both (ADR 0067).
  | "sectorQuestions"
  | "analyzing"
  | "report"
  | "activating"
  | "error";

interface TurnPayload {
  sessionId: string;
  status: string;
  question: DiscoveryQuestion | null;
  progress: DiscoveryProgress | null;
}

interface PlanGenerationPayload {
  missionId: string;
  decisionId: string | null;
  report: GovernanceReportDraft;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * The whole Discovery -> Report -> Plan journey (Product Flow Simplification), one continuous
 * phase-driven flow instead of a Discovery page handing off to a disconnected "preview" and a
 * separately-discovered Plan page. `analyzing` now genuinely creates and runs the
 * `generate_governance_plan` Mission (previously nothing did); `report` is the full ADR 0066 §4
 * consulting-style report, ending in the actual ADR 0044 approval action; approving redirects
 * straight into the living Plan Phase 4 built to receive it.
 */
export function DiscoveryFlow() {
  const t = useTranslations("discoveryInterview");
  // Presentation only: it selects the published translation to show, never the questions
  // asked nor how an answer is stored.
  const locale = useLocale();
  // `promptKey` is a full, root-relative path ("discovery.question.primary_activity") — the
  // engine's contract with the UI (ADR 0066), not scoped under the "discoveryInterview"
  // namespace the rest of this component's chrome copy lives in.
  const tRoot = useTranslations();
  const router = useRouter();
  const { hasRole } = useSession();
  const canApprove = hasRole(...APPROVER_ROLES);

  const [phase, setPhase] = useState<Phase>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState<DiscoveryQuestion | null>(null);
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const [previousAnswer, setPreviousAnswer] = useState<unknown>(undefined);
  const [resumed, setResumed] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sectorInterview, setSectorInterview] = useState<SectorInterview | null>(null);

  const [missionId, setMissionId] = useState<string | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [report, setReport] = useState<GovernanceReportDraft | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  // Set only when the REPORT failed. The interview behind it is already concluded and no longer
  // resumable, so retrying must regenerate from that session — a reload would offer "Start" and
  // make the customer answer every question again.
  const [failedReportSessionId, setFailedReportSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A Mission left awaiting approval (the user reviewed the report, then navigated away)
      // resumes straight into it — Discovery never re-runs for something already decided.
      try {
        const pendingResponse = await fetch("/api/plan-generation/pending");
        if (pendingResponse.ok) {
          const pending = await readJson<PlanGenerationPayload | null>(pendingResponse);
          if (pending?.decisionId) {
            if (cancelled) return;
            setMissionId(pending.missionId);
            setDecisionId(pending.decisionId);
            setReport(pending.report);
            setPhase("report");
            return;
          }
        }
      } catch {
        // fall through — a failed pending-check must never block the flow, only skip the resume
      }
      // An unfinished SECTOR stage. Checked before the active session because by this point the
      // core interview has concluded — the customer is not mid-conversation, they are mid-form,
      // and offering them "Start" would silently discard a concluded session and an open
      // assessment. Looked up by tenant: a returning customer holds no session id.
      try {
        const unfinished = await findOpenSectorInterview(locale);
        // `sourceSessionId` is required, not optional: the plan is generated FROM the session, so
        // resuming into questions that lead nowhere would be a worse trap than starting over.
        if (unfinished.release && unfinished.sourceSessionId && !cancelled) {
          setSessionId(unfinished.sourceSessionId);
          setSectorInterview(unfinished);
          setPhase("sectorQuestions");
          return;
        }
      } catch {
        // Never blocks the flow — a failed resume check only skips the resume.
      }
      try {
        const response = await fetch("/api/discovery/sessions/active");
        if (!response.ok) throw new Error("failed to load active session");
        const turn = await readJson<TurnPayload | null>(response);
        if (cancelled) return;
        if (turn && turn.status === "in_progress") {
          setSessionId(turn.sessionId);
          setQuestion(turn.question);
          setProgress(turn.progress);
          setCanGoBack(true);
          setResumed(true);
          setPhase("interviewing");
        } else {
          setPhase("idle");
        }
      } catch {
        if (!cancelled) setPhase("idle"); // fail open into "start" rather than a hard error
      }
    })();
    return () => {
      cancelled = true;
    };
    // `locale` is read above but deliberately NOT a dependency. This is a mount-once resume, and
    // switching language navigates between /ar and /en — which remounts this component and re-runs
    // the effect with the new locale anyway. Listing it would instead re-run the resume in the
    // middle of a session and throw away the phase the customer is already in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const response = await fetch("/api/discovery/sessions", { method: "POST" });
      if (!response.ok) throw new Error("failed to start session");
      const turn = await readJson<TurnPayload>(response);
      setSessionId(turn.sessionId);
      setQuestion(turn.question);
      setProgress(turn.progress);
      setPreviousAnswer(undefined);
      setCanGoBack(false);
      setPhase("interviewing");
    } catch {
      setPhase("error");
    }
  }, []);

  /**
   * What happens the moment the core interview concludes.
   *
   * The sector stage is asked for FIRST, and skipped when the sector has nothing activated —
   * `no_sector_pack` is a normal answer, not a failure, because most sectors will have no published
   * pack for a long time and an organization must still reach its plan. An outright error is also
   * not allowed to strand the customer: the core interview already concluded, and losing the plan
   * over an optional stage would be a worse failure than not asking the questions.
   */
  const afterCoreInterview = useCallback(
    async (forSessionId: string) => {
      setPhase("analyzing");
      try {
        const interview = await openSectorInterview(forSessionId, locale);
        if (interview.status !== "no_sector_pack" && !interview.completed && interview.release) {
          setSectorInterview(interview);
          setPhase("sectorQuestions");
          return;
        }
      } catch {
        // Fall through to the plan: an unreachable sector stage must not cost the assessment.
      }
      void generateReport(forSessionId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generateReport is defined below
    [],
  );

  const generateReport = useCallback(async (forSessionId: string) => {
    setPhase("analyzing");
    setFailedReportSessionId(null);
    try {
      const response = await fetch("/api/plan-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: forSessionId }),
      });
      if (!response.ok) throw new Error("failed to generate the governance plan");
      const data = await readJson<PlanGenerationPayload>(response);
      if (!data.decisionId) throw new Error("mission never reached the approval gate");
      setMissionId(data.missionId);
      setDecisionId(data.decisionId);
      setReport(data.report);
      setPhase("report");
    } catch {
      setFailedReportSessionId(forSessionId);
      setPhase("error");
    }
  }, []);

  const submitAnswer = useCallback(
    async (value: unknown) => {
      if (!sessionId || !question) return;
      setSubmitting(true);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/discovery/sessions/${sessionId}/answers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, value }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}) as { error?: string });
          setErrorMessage(body.error ?? t("genericError"));
          setSubmitting(false);
          return;
        }
        const turn = await readJson<TurnPayload>(response);
        setSubmitting(false);
        setResumed(false);
        if (turn.status === "concluded") {
          void afterCoreInterview(sessionId);
          return;
        }
        setQuestion(turn.question);
        setProgress(turn.progress);
        setPreviousAnswer(undefined);
        setCanGoBack(true);
      } catch {
        setSubmitting(false);
        setErrorMessage(t("genericError"));
      }
    },
    [sessionId, question, t, afterCoreInterview],
  );

  const skip = useCallback(async () => {
    if (!sessionId || !question) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/discovery/sessions/${sessionId}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}) as { error?: string });
        setErrorMessage(body.error ?? t("genericError"));
        setSubmitting(false);
        return;
      }
      const turn = await readJson<TurnPayload>(response);
      setSubmitting(false);
      setResumed(false);
      if (turn.status === "concluded") {
        void afterCoreInterview(sessionId);
        return;
      }
      setQuestion(turn.question);
      setProgress(turn.progress);
      setPreviousAnswer(undefined);
      setCanGoBack(true);
    } catch {
      setSubmitting(false);
      setErrorMessage(t("genericError"));
    }
  }, [sessionId, question, t, afterCoreInterview]);

  const goBack = useCallback(async () => {
    if (!sessionId) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/discovery/sessions/${sessionId}/back`, { method: "POST" });
      if (!response.ok) {
        // 404 is grc-api's "no earlier question" — a resumed session cannot know it is on the first
        // question until it asks, so the button goes away rather than staying a dead control.
        if (response.status === 404) setCanGoBack(false);
        else setErrorMessage(t("genericError"));
        setSubmitting(false);
        return;
      }
      const target = await readJson<{ question: DiscoveryQuestion; previousAnswer: unknown }>(response);
      setQuestion(target.question);
      setPreviousAnswer(target.previousAnswer);
      setSubmitting(false);
    } catch {
      setSubmitting(false);
      setErrorMessage(t("genericError"));
    }
  }, [sessionId, t]);

  const approve = useCallback(async () => {
    if (!missionId || !decisionId) return;
    setApproving(true);
    setApproveError(null);
    try {
      const response = await fetch(`/api/plan-generation/${missionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}) as { error?: string });
        setApproveError(body.error ?? t("genericError"));
        setApproving(false);
        return;
      }
      setPhase("activating");
      router.push("/plan");
    } catch {
      setApproveError(t("genericError"));
      setApproving(false);
    }
  }, [missionId, decisionId, t, router]);

  if (phase === "loading") {
    return (
      <Card className="flex items-center justify-center gap-2 py-16 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        {t("loading")}
      </Card>
    );
  }

  if (phase === "idle") {
    return (
      <Card grain className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-hairline-strong bg-surface-elevated shadow-soft">
          <Compass className="h-5 w-5 text-accent-foreground" strokeWidth={1.75} />
        </div>
        <div className="max-w-md space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t("title")}</p>
          <p className="text-xs text-foreground-muted">{t("startDescription")}</p>
        </div>
        <button
          type="button"
          onClick={() => void start()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]"
        >
          {t("start")}
        </button>
      </Card>
    );
  }

  if (phase === "error") {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{t("genericError")}</span>
        </div>
        {/* Otherwise a reload re-runs the resume logic above, landing the customer where they were. */}
        <button
          type="button"
          onClick={() =>
            failedReportSessionId
              ? void generateReport(failedReportSessionId)
              : window.location.reload()
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface-elevated px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-surface-2"
        >
          {t("retry")}
        </button>
      </Card>
    );
  }

  if (phase === "sectorQuestions" && sectorInterview && sessionId) {
    return (
      <div className="space-y-5">
        <JourneyStepper current="discovery" />
        <SectorQuestions
          interview={sectorInterview}
          onDone={() => void generateReport(sessionId)}
          onError={(message) => setErrorMessage(message)}
        />
        {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
      </div>
    );
  }

  if (phase === "analyzing") {
    return (
      <div className="space-y-5">
        <JourneyStepper current="report" transitioning />
        <Card grain className="flex flex-col items-center gap-3 py-16 text-center">
          <Sparkles className="h-6 w-6 animate-pulse text-accent-foreground" strokeWidth={1.75} />
          <p className="text-sm font-medium text-foreground">{t("analyzing.title")}</p>
          <p className="max-w-sm text-xs text-foreground-muted">{t("analyzing.description")}</p>
        </Card>
      </div>
    );
  }

  if (phase === "report" && report) {
    return (
      <div className="space-y-5">
        <JourneyStepper current="report" />
        <GovernanceReport
          report={report}
          canApprove={canApprove}
          approving={approving}
          approveError={approveError}
          onApprove={() => void approve()}
        />
      </div>
    );
  }

  if (phase === "activating") {
    return (
      <div className="space-y-5">
        <JourneyStepper current="plan" transitioning />
        <Card grain className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent-foreground" strokeWidth={1.75} />
          <p className="text-sm font-medium text-foreground">{t("activating.title")}</p>
        </Card>
      </div>
    );
  }

  // interviewing
  if (!question || !progress) return null;
  return (
    <div className="space-y-5">
      <JourneyStepper current="discovery" />
      <StageProgress progress={progress} />

      {resumed && <p className="text-xs text-foreground-muted">{t("resumeNotice")}</p>}

      <Card grain className="space-y-4 py-8">
        <p className="text-base font-medium leading-relaxed text-foreground">
          {tRoot(question.promptKey as never)}
        </p>
        <AnswerInput
          question={question}
          initialValue={previousAnswer}
          disabled={submitting}
          onSubmit={(value) => void submitAnswer(value)}
          onSkip={question.required ? undefined : () => void skip()}
        />
        {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
      </Card>

      {canGoBack && (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void goBack()}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors duration-150 hover:text-foreground disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} />
          {t("back")}
        </button>
      )}
    </div>
  );
}
