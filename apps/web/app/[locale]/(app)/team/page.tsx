import type { Metadata } from "next";
import { pageTitle } from "@/lib/pageMetadata";
import { getTranslations } from "next-intl/server";
import { requireRoles } from "@/lib/auth/server";
import { TeamManagement } from "@/components/settings/TeamManagement";

export async function generateMetadata(): Promise<Metadata> {
  return pageTitle("teamPage.title");
}

// Team management is restricted to owners and admins (server-enforced RBAC).
export default async function TeamPage() {
  await requireRoles("owner", "admin");
  const t = await getTranslations("teamPage");

  return (
    <div>
      <header className="pb-7">
        <p className="text-2xs font-medium uppercase tracking-wider text-foreground-muted">
          {t("eyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-foreground-secondary">{t("description")}</p>
      </header>

      <TeamManagement />
    </div>
  );
}
