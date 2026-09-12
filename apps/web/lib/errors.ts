/**
 * Typed application errors mapped to HTTP status codes. Services throw these; route
 * handlers translate them with `toErrorResponse`. Shared across all API surfaces.
 */

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, "validation_error");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You are not permitted to perform this action.") {
    super(403, message, "forbidden");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(404, message, "not_found");
  }
}

/** Someone else changed the record between this caller's read and its write (an optimistic-lock
 * rejection, e.g. Governance Plan item transitions — ADR 0066 Phase 3 hardening). The caller
 * should re-fetch and let the user retry, never blindly resubmit the same stale write. */
export class ConflictError extends AppError {
  constructor(message = "This was changed by someone else. Please refresh and try again.") {
    super(409, message, "conflict");
  }
}

/**
 * A downstream service (e.g. the `apps/api` FastAPI backend) failed or returned an
 * unexpected shape. Distinct from the errors above, which describe *this* app rejecting the
 * request — an `UpstreamError` means the request was valid but the proxied call itself broke.
 *
 * `unreachable` distinguishes "could not even connect" (e.g. `apps/api` isn't deployed in this
 * environment — see `NEXT_PUBLIC_API_BASE_URL`) from "connected but the backend returned an
 * error." Every `lib/*\/service.ts` module that proxies to `apps/api` (`regulationReview`,
 * `knowledgeWorker`) follows the same `call<X>Api` helper shape: a fetch
 * failure throws `new UpstreamError(message, true)`.
 *
 * **Graceful-degradation policy** (apply this consistently to any new proxy call site):
 * - Read-only lists and optional dashboard/statistics widgets MAY catch an `unreachable`
 *   `UpstreamError` and fall back to their existing empty/default response — but only when
 *   that empty state reads as neutral ("nothing here yet"), never as a positive claim (e.g. a
 *   compliance scan's "no gaps found" or "no issues found" is NOT a safe fallback, since it
 *   would misrepresent an unreachable check as a clean result). The call site's `call<X>Api`
 *   invocation should pass `{ onUnreachable: "warn" }` so the failure logs at `warn` (not
 *   `error`) and does not report to Sentry — see `logger.ts`.
 * - Status/control-plane reads that feed a mutating decision (e.g. a trigger button's
 *   enabled state), single-record detail views, scan/review results with a compliance
 *   meaning, and every mutating operation (create/update/delete/approve/reject/trigger) MUST
 *   keep the default `error` logging and continue to throw — losing that failure would be
 *   dangerous or misleading.
 */
export class UpstreamError extends AppError {
  constructor(
    message = "The backend service is unavailable.",
    readonly unreachable = false,
  ) {
    super(502, message, "upstream_error");
  }
}

/** The caller exceeded a usage quota (e.g. the beta per-user daily analysis limit). Maps to
 * HTTP 429 and carries a stable `code` the UI keys off to render a localized, user-friendly
 * message. */
export class RateLimitError extends AppError {
  constructor(message = "Usage limit reached.", code = "rate_limited") {
    super(429, message, code);
  }
}
