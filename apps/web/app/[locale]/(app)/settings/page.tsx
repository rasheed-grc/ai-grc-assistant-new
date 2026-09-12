import type { Metadata } from "next";
import { pageTitle } from "@/lib/pageMetadata";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/server";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

export async function generateMetadata(): Promise<Metadata> {
  return pageTitle("placeholders.settings.title");
}

// Every authenticated user can open Settings — Profile and Security are self-service for anyone;
// the Organization and Team tabs stay visible to everyone (any member may see who has access and
// what the organization is) but their write actions are owner/admin-gated inside the tab itself,
// enforced again server-side by the underlying services (organizations/service.ts).
export default async function SettingsPage() {
  await requireSession();
  const t = await getTranslations("placeholders.settings");

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

      <SettingsWorkspace />
    </div>
  );
}
