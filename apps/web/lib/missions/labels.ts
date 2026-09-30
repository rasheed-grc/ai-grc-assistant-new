/**
 * What a mission shows a person, as opposed to what the engine stores.
 *
 * The engine's `scope` is sometimes a subject ("Technological controls") and sometimes an id (a
 * governance plan's discovery session); its step descriptions are English authored in the mission's
 * plan factory; and some steps' output is structured data meant for the next step, not a reader.
 */

const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{24,}$/i;

/** The scope when it is a subject a person would recognise; `null` when it is only an id. */
export function missionSubject(scope: string): string | null {
  const trimmed = scope.trim();
  return trimmed && !OPAQUE_ID.test(trimmed) ? trimmed : null;
}

/** `"Resolve the organization's applicability analysis"` → `resolve_the_organization_s_applicability_analysis`. */
export function stepKey(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** The step's label in the page's language, or the engine's own wording for a step this interface
 * has no label for — a mission type can gain steps without this file knowing. */
export function stepLabel(translate: { has: (key: never) => boolean } & ((key: never) => string), description: string): string {
  const key = `step.${stepKey(description)}` as never;
  return translate.has(key) ? translate(key) : description;
}

/** Output that is a JSON document is a hand-off between steps, not something to read. */
export function isStructuredOutput(summary: string): boolean {
  const trimmed = summary.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
