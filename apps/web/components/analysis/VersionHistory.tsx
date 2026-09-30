"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TrendPill } from "@/components/ui/TrendPill";
import { useDeleteAnalysis, useRenameAnalysis } from "@/hooks/useAnalyses";
import type { AnalysisRecord } from "@/lib/analysis/types";
import { cn, formatDate } from "@/lib/utils";

interface VersionHistoryProps {
  documentId: string;
  versions: AnalysisRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** Score-delta comparison between consecutive versions — not a full document text diff. */
export function VersionHistory({ documentId, versions, selectedId, onSelect }: VersionHistoryProps) {
  const t = useTranslations("versionHistory");
  const locale = useLocale();
  const rename = useRenameAnalysis(documentId);
  const del = useDeleteAnalysis(documentId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (versions.length < 2) return null;

  function startEdit(version: AnalysisRecord) {
    setEditingId(version.id);
    setDraftTitle(version.title);
  }

  function commitEdit(analysisId: string) {
    const title = draftTitle.trim();
    if (title) rename.mutate({ analysisId, title });
    setEditingId(null);
  }

  return (
    <Card flush>
      <div className="px-5 pt-4">
        <SectionHeader
          title={t("title")}
          description={t("description", { count: versions.length })}
        />
      </div>
      <div className="mt-3 divide-y divide-hairline">
        {versions.map((version, i) => {
          const previous = versions[i + 1]; // sorted newest-first: next in array is the prior version
          const complianceDelta =
            previous && version.complianceScore != null && previous.complianceScore != null
              ? version.complianceScore - previous.complianceScore
              : null;
          const riskDelta =
            previous && version.riskScore != null && previous.riskScore != null
              ? version.riskScore - previous.riskScore
              : null;
          const isSelected = version.id === selectedId;
          const isEditing = editingId === version.id;
          const isConfirmingDelete = confirmingId === version.id;

          return (
            <div
              key={version.id}
              className={cn("flex items-center gap-3 px-5 py-3", isSelected && "bg-accent-soft")}
            >
              {isEditing ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(version.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-8 min-w-0 flex-1 rounded-md border border-hairline-strong bg-surface px-2 text-sm text-foreground outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commitEdit(version.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-success hover:bg-success-soft"
                    aria-label={t("saveName")}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-elevated"
                    aria-label={t("cancel")}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(version.id)}
                  className="min-w-0 flex-1 text-start"
                >
                  <p className="truncate text-sm font-medium text-foreground">{version.title}</p>
                  <p className="text-2xs text-foreground-muted">
                    v{version.version} · {formatDate(version.createdAt, locale)}
                    {version.status !== "processed" ? ` · ${version.status}` : ""}
                  </p>
                </button>
              )}

              {!isEditing && (
                <div className="flex shrink-0 items-center gap-3">
                  {complianceDelta != null && complianceDelta !== 0 && (
                    <TrendPill
                      trend={complianceDelta > 0 ? "up" : "down"}
                      value={Math.abs(complianceDelta)}
                      goodWhen="up"
                      suffix={t("complianceSuffix")}
                    />
                  )}
                  {riskDelta != null && riskDelta !== 0 && (
                    <TrendPill
                      trend={riskDelta > 0 ? "up" : "down"}
                      value={Math.abs(riskDelta)}
                      goodWhen="down"
                      suffix={t("riskSuffix")}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(version)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground"
                    aria-label={t("rename")}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    disabled={del.isPending}
                    onClick={() => {
                      if (isConfirmingDelete) del.mutate(version.id);
                      else {
                        setConfirmingId(version.id);
                        setTimeout(() => setConfirmingId(null), 3000);
                      }
                    }}
                    className={cn(
                      "inline-flex h-7 items-center justify-center rounded-md px-1.5 text-2xs font-medium transition-colors duration-150",
                      isConfirmingDelete
                        ? "bg-danger-soft text-danger"
                        : "text-foreground-muted hover:bg-surface-elevated hover:text-foreground",
                    )}
                    aria-label={t("deleteVersion")}
                  >
                    {del.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    {isConfirmingDelete && <span className="ms-1">{t("confirm")}</span>}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
