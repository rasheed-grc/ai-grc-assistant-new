"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "@/i18n/navigation";
import { useCreateMission } from "@/hooks/useMissions";
import type { StartableMissionType } from "@/lib/missions/types";
import { cn } from "@/lib/utils";

export function StartMissionModal({
  type,
  onClose,
}: {
  type: StartableMissionType;
  onClose: () => void;
}) {
  const t = useTranslations("missionsPage.catalog");
  const router = useRouter();
  const create = useCreateMission();
  const [scope, setScope] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!scope.trim()) {
      setError(t("scopeRequired"));
      return;
    }
    try {
      const created = await create.mutateAsync({ type, scope: scope.trim() });
      // The review station lives on the mission's own page — created, planned, not yet run.
      router.push(`/missions/${created.mission.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("startError"));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t(`${type}.name`)}
      description={t("modal.description")}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground-secondary hover:text-foreground"
          >
            {t("modal.cancel")}
          </button>
          <button
            type="submit"
            form="start-mission-form"
            disabled={create.isPending}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow hover:opacity-90 active:scale-[0.98]",
              create.isPending && "opacity-60",
            )}
          >
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            {t("modal.submit")}
          </button>
        </>
      }
    >
      <form id="start-mission-form" onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">
            {t("scopeLabel")}
          </span>
          <textarea
            required
            rows={3}
            autoFocus
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder={t(`${type}.scopePlaceholder`)}
            className="w-full resize-none rounded-lg border border-hairline bg-surface/60 px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus:border-hairline-strong focus:bg-surface-2"
          />
          <span className="mt-1.5 block text-2xs text-foreground-muted">
            {t(`${type}.needs`)}
          </span>
        </label>
      </form>
    </Modal>
  );
}
