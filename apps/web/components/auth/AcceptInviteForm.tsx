"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Lock, ShieldHalf, TriangleAlert, User } from "lucide-react";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/auth/config";
import { acceptInvitation, fetchInvitationPreview, type InvitationPreviewDto } from "@/lib/invitations/client";

type LoadState =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "ready"; preview: InvitationPreviewDto };

export function AcceptInviteForm() {
  const t = useTranslations("acceptInvitePage");
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoad({ status: "invalid", message: t("missingToken") });
      return;
    }
    let cancelled = false;
    fetchInvitationPreview(token)
      .then((preview) => {
        if (!cancelled) setLoad({ status: "ready", preview });
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "invalid",
            message: fetchError instanceof Error ? fetchError.message : t("invalidToken"),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }
    // Same minimum as the server, said in the page's language.
    if (password.length < 10) {
      setError(t("passwordTooShort"));
      return;
    }
    setIsSubmitting(true);
    try {
      await acceptInvitation(token, { name, password });
      window.location.assign(DEFAULT_AUTHENTICATED_PATH);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("genericError"));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline-strong bg-surface-2 shadow-soft">
          <ShieldHalf className="h-6 w-6 text-accent-foreground" strokeWidth={1.75} />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-foreground-secondary">{t("subtitle")}</p>
      </div>

      {load.status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-foreground-secondary">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          {t("loading")}
        </div>
      )}

      {load.status === "invalid" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-foreground"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
          <span>{load.message}</span>
        </div>
      )}

      {load.status === "ready" && (
        <>
          <div className="mb-5 rounded-xl border border-hairline bg-surface/40 p-4 text-sm">
            <p className="text-foreground-secondary">{t("invitedAs", { email: load.preview.email })}</p>
            <p className="mt-1 font-medium text-foreground">{load.preview.organizationName}</p>
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
                {t("nameLabel")}
              </span>
              <span className="relative block">
                <User
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                  strokeWidth={1.75}
                />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  className="h-10 w-full rounded-lg border border-hairline bg-surface/60 ps-9 pe-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-muted focus:border-hairline-strong focus:bg-surface-2"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                {t("passwordLabel")}
              </span>
              <span className="relative block">
                <Lock
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                  strokeWidth={1.75}
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="h-10 w-full rounded-lg border border-hairline bg-surface/60 ps-9 pe-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-muted focus:border-hairline-strong focus:bg-surface-2"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                {t("confirmPasswordLabel")}
              </span>
              <span className="relative block">
                <Lock
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                  strokeWidth={1.75}
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                  {t("submitting")}
                </>
              ) : (
                t("submit")
              )}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
