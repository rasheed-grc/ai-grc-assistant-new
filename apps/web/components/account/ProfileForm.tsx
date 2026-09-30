"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useSession } from "@/components/auth/SessionProvider";
import { primaryRole } from "@/lib/auth/roles";
import { updateProfileName } from "@/lib/account/client";

const inputClass =
  "h-10 w-full rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-hairline-strong focus:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-70";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">{children}</span>
  );
}

export function ProfileForm() {
  const t = useTranslations("profilePage");
  const tRoles = useTranslations("teamManagement.roles");
  const { user } = useSession();
  const role = primaryRole(user.roles);

  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateProfileName(name);
      // Full reload so the server-rendered shell (sidebar/user menu) picks up the new name
      // from the freshly re-signed session cookie.
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("genericError"));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent/40 to-accent/10 text-lg font-semibold text-accent-foreground">
          {user.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
          <p className="truncate text-xs text-foreground-muted">{user.email}</p>
          {role && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent-foreground">
              {tRoles(role)}
            </span>
          )}
        </div>
      </Card>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <h2 className="text-sm font-semibold text-foreground">{t("detailsTitle")}</h2>

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
            <FieldLabel>{t("nameLabel")}</FieldLabel>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <FieldLabel>{t("emailLabel")}</FieldLabel>
            <input type="email" value={user.email} disabled className={inputClass} />
            <span className="mt-1 block text-2xs text-foreground-muted">{t("emailHint")}</span>
          </label>

          <label className="block">
            <FieldLabel>{t("organizationLabel")}</FieldLabel>
            <input type="text" value={user.organizationName} disabled className={inputClass} />
          </label>

          <button
            type="submit"
            disabled={isSubmitting || name.trim().length === 0}
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
