/**
 * Shared report timestamp formatting — used by the on-screen preview, the PDF renderer, and the
 * Excel renderer, so a report's "generated at" line is never a raw, unlabeled UTC string. Every
 * caller has an explicit locale but no organization/user timezone preference exists yet (that
 * belongs to Settings, not to reports), so the honest fix here is a clearly-labeled UTC time
 * rather than an unlabeled one — never a fabricated "local" timezone.
 */

export function formatReportTimestamp(iso: string, locale: "ar" | "en"): string {
  const date = new Date(iso);
  // `dateStyle`/`timeStyle` cannot be combined with `timeZoneName` (throws "Invalid option" in
  // V8) — spell out the equivalent component options instead and append the "UTC" label
  // ourselves, since there is no per-user/org timezone preference to show instead (see the file
  // header comment).
  const formatted = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

export function formatReportDate(
  value: string | number | null,
  locale: "ar" | "en",
  emptyLabel: string,
): string {
  if (value === null) return emptyLabel;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
