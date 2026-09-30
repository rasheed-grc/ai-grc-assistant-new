import type { AppLocale } from "@/i18n/routing";

/** Absolute date + time in the user's chosen time zone, e.g. "29 Jun 2026, 14:05". Falls back to
 * UTC when the zone is unknown, so a bad stored value can never break a page. */
export function formatDateTimeInZone(iso: string, timeZone: string, locale: AppLocale): string {
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const target = locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB";
  try {
    return new Intl.DateTimeFormat(target, { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(target, { ...options, timeZone: "UTC" }).format(new Date(iso));
  }
}

/** A calendar date with no zone of its own (a plan due date), rendered in the page's language. */
export function formatCalendarDate(
  date: Date,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" },
): string {
  const target = locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB";
  return new Intl.DateTimeFormat(target, { ...options, timeZone: "UTC" }).format(date);
}

/** Short date in the user's zone (the Team table, where a time-of-day is noise). */
export function formatDateInZone(iso: string, timeZone: string, locale: AppLocale): string {
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };
  const target = locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB";
  try {
    return new Intl.DateTimeFormat(target, { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(target, { ...options, timeZone: "UTC" }).format(new Date(iso));
  }
}
