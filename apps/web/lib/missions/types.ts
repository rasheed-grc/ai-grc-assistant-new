/**
 * A Mission as the workspace lists it (CLAUDE.md §8).
 *
 * **One source of truth: the V2 Mission Engine** (ADR 0042), read through grc-api — the single
 * product API surface (ADR 0052). Nothing is copied here and nothing is synchronised; the engine
 * owns the mission and this is a projection of what it says right now.
 *
 * This shape is what the engine's LIST actually knows. It deliberately does not carry a step count
 * or an owner name: the read model does not project them, and columns that are permanently empty
 * tell a customer less than columns that are not there.
 */

/** The lifecycle, exactly as `mission_engine.lifecycle.MissionStatus` names it. Duplicated here
 * rather than inferred: this list is what the UI can label, and it should fail visibly when the
 * engine grows a state the workspace has never heard of. */
export const MISSION_STATUSES = [
  "created",
  "planned",
  "executing",
  "awaiting_approval",
  "resumed",
  "completed",
  "failed",
  "cancelled",
  "archived",
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export function isMissionStatus(value: string): value is MissionStatus {
  return (MISSION_STATUSES as readonly string[]).includes(value);
}

export interface Mission {
  id: string;
  /** The product's Mission Type id (`generate_governance_plan`, `gap_assessment`, …). */
  type: string;
  /** The human-readable subject the mission runs against. */
  scope: string;
  status: string;
  /** Derived, not stored: the engine pauses AT this status, so it is the same fact. */
  awaitingApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The Mission types this workspace lets a user start directly, from a catalog of cards — as
 * opposed to types like `generate_governance_plan` that start their own way (the Discovery
 * interview) or `simple_question` (the AI Assistant chat). Adding a type here is a UI-only change:
 * the type must already be one grc-api's `default_mission_catalog()` registers, and its plan
 * factory must already read its subject from the single `scope` string `POST /v1/missions` sends
 * (every built-in composite mission does — `MissionDefinitionProvider.define` always maps the
 * catalog's one free-text `request` input from it). */
export const STARTABLE_MISSION_TYPES = ["gap_assessment", "risk_assessment"] as const;
export type StartableMissionType = (typeof STARTABLE_MISSION_TYPES)[number];

export function isStartableMissionType(value: string): value is StartableMissionType {
  return (STARTABLE_MISSION_TYPES as readonly string[]).includes(value);
}

/** One step of the mission's plan, exactly as `MissionDetailView.plan` projects it — an id and the
 * human-readable description authored on the Mission type's plan factory (never a tool name). */
export interface MissionPlanStep {
  id: string;
  description: string;
}

/** One step's real output once it has run. `findings[i]` corresponds to `plan[i]` — the engine
 * records them in step order, so their shared index is how the UI knows which step a finding
 * belongs to without the backend repeating a redundant step id on both sides. */
export interface MissionFinding {
  stepId: string;
  title: string;
  summary: string;
  citations: string[];
  confidence: number | null;
}

/** The full Mission — plan + progress — for the review station and the run/progress view. */
export interface MissionDetail {
  id: string;
  type: string;
  scope: string;
  status: MissionStatus;
  plan: MissionPlanStep[];
  findings: MissionFinding[];
  awaitingApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The response to creating a mission — the "review station": what was created, and how big it
 * is, before anyone runs it (CLAUDE.md's AI Transparency pillar — what will run, shown first). */
export interface CreatedMission {
  mission: MissionDetail;
  steps: number;
  humanApprovals: number;
}

// --- Result (the engine calls it a Deliverable; the product never uses that word) -------------

export interface ResultSection {
  heading: string;
  body: string;
  citations: string[];
  confidence: number | null;
}

export interface GapRow {
  controlCode: string;
  controlTitle: string;
  covered: boolean;
  evidence: string[];
}

export interface Coverage {
  framework: string;
  coverage: number;
  coveredCount: number;
  total: number;
  gaps: GapRow[];
}

/** `humanReview` mirrors the engine's own words exactly ("Not required" | "Pending" | "Approved" |
 * "Rejected") — none of `gap_assessment`/`risk_assessment`'s steps are consequential, so a real
 * mission through this UI always reads "Not required"; the other values are real regardless the
 * moment a Mission type with a human gate is added to the catalog above. */
export interface MissionResult {
  missionId: string;
  title: string;
  evidenceCount: number;
  humanReview: string;
  updatedAt: string;
  sections: ResultSection[];
  /** Present only for `kind === "gap_assessment"` — the coverage/gaps table `GenericContent`
   * (every other mission type today) does not carry. */
  coverage: Coverage | null;
}
