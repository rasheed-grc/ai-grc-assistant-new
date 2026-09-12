"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { STARTABLE_MISSION_TYPES, type StartableMissionType } from "@/lib/missions/types";
import { StartMissionModal } from "./StartMissionModal";

const CATALOG_ICON: Record<StartableMissionType, typeof ShieldCheck> = {
  gap_assessment: ShieldCheck,
  risk_assessment: TriangleAlert,
};

/**
 * The real launcher for the two Mission types this workspace lets a user start directly
 * (`lib/missions/types.ts#STARTABLE_MISSION_TYPES`) — the entry point Mission-Centric UX requires
 * (CLAUDE.md §18): a person picks a mission by what it does for them, not by knowing an API
 * exists. Each card states what the mission is, why to run it, and what it needs *before* asking
 * for a commitment, matching the AI Transparency pillar (§19) applied one step earlier than usual
 * — transparent about the plan even before the mission is created.
 */
export function MissionCatalog() {
  const t = useTranslations("missionsPage.catalog");
  const [starting, setStarting] = useState<StartableMissionType | null>(null);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {STARTABLE_MISSION_TYPES.map((type) => {
          const Icon = CATALOG_ICON[type];
          return (
            <Card key={type} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-hairline bg-surface-2">
                  <Icon className="h-4.5 w-4.5 text-accent-foreground" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{t(`${type}.name`)}</h3>
                  <p className="mt-0.5 text-xs text-foreground-secondary">
                    {t(`${type}.description`)}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 rounded-lg border border-hairline bg-surface/60 px-3 py-2.5">
                <p className="text-2xs font-medium uppercase tracking-wide text-foreground-muted">
                  {t("whyLabel")}
                </p>
                <p className="text-xs text-foreground-secondary">{t(`${type}.why`)}</p>
              </div>
              <div className="space-y-1.5 rounded-lg border border-hairline bg-surface/60 px-3 py-2.5">
                <p className="text-2xs font-medium uppercase tracking-wide text-foreground-muted">
                  {t("needsLabel")}
                </p>
                <p className="text-xs text-foreground-secondary">{t(`${type}.needs`)}</p>
              </div>

              <button
                type="button"
                onClick={() => setStarting(type)}
                className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]"
              >
                {t("startButton")}
              </button>
            </Card>
          );
        })}
      </div>

      {starting && (
        <StartMissionModal type={starting} onClose={() => setStarting(null)} />
      )}
    </div>
  );
}
