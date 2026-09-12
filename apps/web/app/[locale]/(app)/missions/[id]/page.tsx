import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth/server";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import { MissionWorkspace } from "@/components/missions/MissionWorkspace";
import { pageTitle } from "@/lib/pageMetadata";

export async function generateMetadata(): Promise<Metadata> {
  return pageTitle("missionsPage.title");
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MissionDetailPage({ params }: PageProps) {
  await requireSession();
  const { id } = await params;
  const t = await getTranslations("missionsPage");

  return (
    <div>
      <header className="pb-7">
        <Link
          href="/missions"
          className="inline-flex items-center gap-1 text-2xs font-medium uppercase tracking-wider text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3 rtl:rotate-180" strokeWidth={2} />
          {t("title")}
        </Link>
      </header>

      <MissionWorkspace missionId={id} />
    </div>
  );
}
