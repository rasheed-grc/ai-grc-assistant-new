"use client";

import { useMemo, useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { FavoriteButton } from "@/components/ui/FavoriteButton";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useAnalyses } from "@/hooks/useAnalyses";
import { useDocuments } from "@/hooks/useDocuments";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/documents/types";
import { cn, formatDate, formatNumber } from "@/lib/utils";

export function AnalysisHistory() {
  const t = useTranslations("analysisHistory");
  const locale = useLocale();
  const tCategory = useTranslations("documentCategories");
  const { data: analyses, isLoading, isError, error } = useAnalyses();
  const { data: documents } = useDocuments();
  const [categoryFilter, setCategoryFilter] = useState<DocumentCategory | "all">("all");

  const categoryByDocumentId = useMemo(() => {
    const map = new Map<string, DocumentCategory>();
    for (const doc of documents ?? []) map.set(doc.id, doc.category);
    return map;
  }, [documents]);

  const filtered = useMemo(() => {
    if (!analyses) return [];
    if (categoryFilter === "all") return analyses;
    return analyses.filter((a) => categoryByDocumentId.get(a.documentId) === categoryFilter);
  }, [analyses, categoryFilter, categoryByDocumentId]);

  if (isLoading) {
    return (
      <Card flush>
        <div className="divide-y divide-hairline">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3.5 px-5 py-3.5">
              <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
              <Skeleton className="h-4 w-48 max-w-[40%]" />
              <Skeleton className="ms-auto h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="hidden h-4 w-16 sm:block" />
              <Skeleton className="hidden h-4 w-20 sm:block" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="py-10 text-center text-sm text-danger">{(error as Error).message}</Card>
    );
  }

  if (!analyses || analyses.length === 0) {
    return (
      <Card grain className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline-strong bg-surface-2">
          <Sparkles className="h-5 w-5 text-foreground-muted" strokeWidth={1.75} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="text-xs text-foreground-muted">
            {t("emptyDescription")}
          </p>
        </div>
        <Link
          href="/upload"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground-secondary transition-colors duration-150 hover:border-hairline-strong hover:text-foreground"
        >
          <FileText className="h-4 w-4" strokeWidth={1.75} />
          {t("goToUploadCenter")}
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategoryFilter("all")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors duration-150",
            categoryFilter === "all"
              ? "border-accent/40 bg-accent-soft text-accent-foreground"
              : "border-hairline bg-surface text-foreground-secondary hover:border-hairline-strong",
          )}
        >
          {t("all")}
        </button>
        {DOCUMENT_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setCategoryFilter(category)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors duration-150",
              categoryFilter === category
                ? "border-accent/40 bg-accent-soft text-accent-foreground"
                : "border-hairline bg-surface text-foreground-secondary hover:border-hairline-strong",
            )}
          >
            {tCategory(category)}
          </button>
        ))}
      </div>

      <Card flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-start text-2xs uppercase tracking-wider text-foreground-muted">
                <th className="px-5 py-2.5 font-medium">{t("columns.document")}</th>
                <th className="px-3 py-2.5 font-medium">{t("columns.category")}</th>
                <th className="px-3 py-2.5 font-medium">{t("columns.status")}</th>
                <th className="px-3 py-2.5 font-medium">{t("columns.versions")}</th>
                <th className="px-3 py-2.5 font-medium">{t("columns.findings")}</th>
                <th className="px-3 py-2.5 font-medium">{t("columns.analyzed")}</th>
                <th className="px-5 py-2.5 text-end font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((analysis) => {
                const category = categoryByDocumentId.get(analysis.documentId);
                return (
                  <tr
                    key={analysis.documentId}
                    className="border-b border-hairline last:border-0 hover:bg-surface-elevated/60"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <FavoriteButton
                          item={{
                            id: analysis.documentId,
                            type: "document",
                            title: analysis.fileName,
                            subtitle: category ? tCategory(category) : undefined,
                            href: `/analysis?doc=${analysis.documentId}`,
                          }}
                          className="-ms-1.5"
                        />
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2">
                          <FileText className="h-4 w-4 text-foreground-secondary" strokeWidth={1.75} />
                        </span>
                        <span className="truncate font-medium text-foreground">
                          {analysis.fileName}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {category && <Badge tone="neutral">{tCategory(category)}</Badge>}
                    </td>
                    <td className="px-3 py-3">
                      <DocumentStatusBadge status={analysis.status} />
                    </td>
                    <td className="px-3 py-3 text-foreground-secondary">
                      v{analysis.version}
                      {analysis.versionCount > 1 && (
                        <span className="ms-1 text-2xs text-foreground-muted">
                          {t("ofCount", { count: analysis.versionCount })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-foreground-secondary">
                      {formatNumber(analysis.findings.length)}
                    </td>
                    <td className="px-3 py-3 text-foreground-muted">
                      {formatDate(analysis.createdAt, locale)}
                    </td>
                    <td className="px-5 py-3 text-end">
                      <Link
                        href={`/analysis?doc=${analysis.documentId}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-hairline bg-surface/60 px-2 text-2xs font-medium text-foreground-secondary transition-colors duration-150 hover:border-hairline-strong hover:text-foreground"
                      >
                        {t("view")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
