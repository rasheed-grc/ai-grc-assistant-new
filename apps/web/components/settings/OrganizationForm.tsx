"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useSession } from "@/components/auth/SessionProvider";
import { useOrganizations, useUpdateOrganization } from "@/hooks/useOrganizations";

const inputClass =
  "h-10 w-full rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground outline-none transition-colors duration-150 focus:border-hairline-strong focus:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-70";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">{children}</span>
  );
}

export function OrganizationForm() {
  const t = useTranslations("organizationSettings");
  const { hasRole } = useSession();
  const canEdit = hasRole("owner", "admin");
  const { data, isLoading, isError } = useOrganizations();
  const update = useUpdateOrganization();

  const current = data?.organizations.find((org) => org.id === data.activeOrganizationId) ?? null;

  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState("");
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    setName(current.name);
    setOrgType(current.orgType);
    setIndustry(current.industry);
  }, [current]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({ name, orgType, industry });
      // Full reload so the server-rendered shell (sidebar/user menu) picks up the new
      // organization name from the freshly re-signed session cookie — mirrors ProfileForm.
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("genericError"));
    }
  }

  if (isLoading) {
    return (
      <Card>
        <p className="text-sm text-foreground-secondary">{t("loading")}</p>
      </Card>
    );
  }

  if (isError || !current) {
    return (
      <Card>
        <div className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{t("loadError")}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-foreground-secondary">
            {canEdit ? t("subtitleEditable") : t("subtitleReadOnly")}
          </p>
        </div>

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
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <FieldLabel>{t("typeLabel")}</FieldLabel>
          <input
            type="text"
            required
            value={orgType}
            disabled={!canEdit}
            onChange={(e) => setOrgType(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <FieldLabel>{t("industryLabel")}</FieldLabel>
          <input
            type="text"
            required
            value={industry}
            disabled={!canEdit}
            onChange={(e) => setIndustry(e.target.value)}
            className={inputClass}
          />
        </label>

        {canEdit && (
          <button
            type="submit"
            disabled={update.isPending || name.trim().length === 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {update.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </button>
        )}
      </form>
    </Card>
  );
}
