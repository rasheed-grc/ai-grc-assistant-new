"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { routing } from "@/i18n/routing";
import { usePathname } from "@/i18n/navigation";
import { usePreferences, useSavePreferences } from "@/hooks/usePreferences";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/preferences/types";

const selectClass =
  "h-10 w-full rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-hairline-strong focus:bg-surface-2 disabled:opacity-70";

function timeZoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = new Set<string>(["UTC", ...supported]);
  zones.add(current);
  return [...zones].sort();
}

/** Language, time zone and notification categories — each one is persisted and honored: the
 * language redirects the app, the time zone renders dates, the categories decide what the bell
 * derives. */
export function PreferencesForm() {
  const t = useTranslations("preferences");
  const currentLocale = useLocale();
  const pathname = usePathname();
  const { data: prefs, isLoading, isError } = usePreferences();
  const save = useSavePreferences();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const zones = useMemo(() => timeZoneOptions(prefs?.timezone ?? "Asia/Riyadh"), [prefs?.timezone]);

  if (isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" strokeWidth={2} />;
  }
  if (isError || !prefs) {
    return <p className="text-sm text-danger">{t("loadError")}</p>;
  }

  function run(patch: Parameters<typeof save.mutate>[0], onDone?: () => void) {
    setError(null);
    setSaved(false);
    save.mutate(patch, {
      onSuccess: () => {
        setSaved(true);
        onDone?.();
      },
      onError: (e) => setError(e.message),
    });
  }

  const chosenLocale = prefs.locale ?? currentLocale;

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        <p className="mt-1 text-xs text-foreground-muted">{t("subtitle")}</p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">
          {t("language")}
        </span>
        <select
          className={selectClass}
          value={chosenLocale}
          disabled={save.isPending}
          onChange={(e) => {
            const next = e.target.value as "ar" | "en";
            run({ locale: next }, () => {
              // Full navigation, same reason as LanguageSwitcher (root layout owns <html dir>).
              if (next !== currentLocale) {
                window.location.assign(`/${next}${pathname === "/" ? "" : pathname}`);
              }
            });
          }}
        >
          {routing.locales.map((loc) => (
            <option key={loc} value={loc}>
              {t(`languageOption.${loc}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">
          {t("timezone")}
        </span>
        <select
          className={selectClass}
          value={prefs.timezone}
          disabled={save.isPending}
          onChange={(e) => run({ timezone: e.target.value })}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-2xs text-foreground-muted">{t("timezoneHint")}</span>
      </label>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-foreground-secondary">
          {t("notifications")}
        </legend>
        {NOTIFICATION_CATEGORIES.map((category: NotificationCategory) => (
          <label key={category} className="flex items-start gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--accent,#2563eb)]"
              checked={prefs.notifications[category]}
              disabled={save.isPending}
              onChange={(e) => run({ notifications: { [category]: e.target.checked } })}
            />
            <span>
              {t(`category.${category}.label`)}
              <span className="block text-2xs text-foreground-muted">
                {t(`category.${category}.hint`)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && (
        <div role="alert" className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}
      {saved && !error && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          {t("saved")}
        </p>
      )}
    </Card>
  );
}
