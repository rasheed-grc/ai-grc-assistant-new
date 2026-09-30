"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useSession } from "@/components/auth/SessionProvider";
import { primaryRole } from "@/lib/auth/roles";
import { AccountRequestError, changeAccountPassword } from "@/lib/account/client";

const inputClass =
  "h-10 w-full rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-hairline-strong focus:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-70";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">{children}</span>
  );
}

export function SecurityAccessForm() {
  const t = useTranslations("securityAccessPage");
  const tTeam = useTranslations("teamManagement");
  const { user } = useSession();
  const role = primaryRole(user.roles);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }
    // Same minimum as the server (lib/account/service.ts), said in the page's language.
    if (newPassword.length < 10) {
      setError(t("passwordTooShort"));
      return;
    }
    setIsSubmitting(true);
    try {
      await changeAccountPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError(
        submitError instanceof AccountRequestError &&
          submitError.code === "current_password_incorrect"
          ? t("currentPasswordIncorrect")
          : submitError instanceof Error
            ? submitError.message
            : t("genericError"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline-strong bg-surface-2">
            <ShieldCheck className="h-4 w-4 text-accent-foreground" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{t("accessTitle")}</h2>
            <p className="mt-0.5 text-xs text-foreground-secondary">
              {t("accessDescription", { organization: user.organizationName })}
            </p>
            {role && (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent-foreground">
                  {tTeam(`roles.${role}`)}
                </span>
                <span className="text-2xs text-foreground-muted">
                  {tTeam(`roleDescriptions.${role}`)}
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <h2 className="text-sm font-semibold text-foreground">{t("passwordTitle")}</h2>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-foreground"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-sm text-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
              <span>{t("passwordChanged")}</span>
            </div>
          )}

          <label className="block">
            <FieldLabel>{t("currentPasswordLabel")}</FieldLabel>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <FieldLabel>{t("newPasswordLabel")}</FieldLabel>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <FieldLabel>{t("confirmPasswordLabel")}</FieldLabel>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </button>
        </form>
      </Card>
    </div>
  );
}
