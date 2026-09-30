"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Loader2, Lock, Mail, TriangleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LogoMark } from "@/components/ui/Logo";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/auth/config";

/** Restrict post-login redirects to in-app paths to prevent open-redirect abuse. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_AUTHENTICATED_PATH;
  return raw;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const t = useTranslations("login");
  const currentLocale = useLocale();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        // The API's messages are English; the ones a person can hit are shown in the page language.
        setError(
          response.status === 401
            ? t("invalidCredentials")
            : response.status === 429
              ? t("tooManyAttempts")
              : t("signInFailed"),
        );
        setIsSubmitting(false);
        return;
      }
      // Full navigation so the edge middleware sees the new cookie immediately.
      const data = (await response.json().catch(() => ({}))) as { locale?: string | null };
      const preferred = data.locale === "ar" || data.locale === "en" ? data.locale : null;
      if (preferred && preferred !== currentLocale) {
        // Honor the saved language: swap the locale segment of the destination.
        const rest = next.replace(/^\/(ar|en)(?=\/|$)/, "");
        window.location.assign(`/${preferred}${rest === "/" ? "" : rest}`);
        return;
      }
      window.location.assign(next);
    } catch {
      setError(t("networkError"));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center text-center">
        <LogoMark size={44} priority />
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{t("subtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-foreground"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">
            {t("emailLabel")}
          </span>
          <span className="relative block">
            <Mail
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
              strokeWidth={1.75}
            />
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              className="h-10 w-full rounded-lg border border-hairline bg-surface/60 ps-9 pe-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-muted focus:border-hairline-strong focus:bg-surface-2"
            />
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-foreground-secondary">
            {t("passwordLabel")}
            <Link
              href="/forgot-password"
              className="font-medium text-accent-foreground hover:underline"
            >
              {t("forgotPassword")}
            </Link>
          </span>
          <span className="relative block">
            <Lock
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
              strokeWidth={1.75}
            />
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="h-10 w-full rounded-lg border border-hairline bg-surface/60 ps-9 pe-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-muted focus:border-hairline-strong focus:bg-surface-2"
            />
          </span>
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              {t("signingIn")}
            </>
          ) : (
            <>
              {t("signIn")}
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </>
          )}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-foreground-secondary">
        {t("noAccount")}{" "}
        <Link href="/request-access" className="font-medium text-accent-foreground hover:underline">
          {t("requestAccess")}
        </Link>
      </p>
    </div>
  );
}
