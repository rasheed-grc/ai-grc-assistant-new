/**
 * Minimal class-name joiner. Keeps the design system dependency-free
 * (no clsx/tailwind-merge) while supporting conditional classes.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

/** Format a number with thousands separators (en-US, deterministic for SSR). */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Human-readable byte size, e.g. 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

/** Short absolute date, e.g. "29 Jun 2026". Deterministic (UTC) to avoid SSR hydration drift. */
export function formatDate(iso: string, locale: string = "en"): string {
  // Latin digits in Arabic too, matching the rest of the app (lib/preferences/format.ts).
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}
