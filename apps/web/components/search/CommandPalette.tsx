"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X, History, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { useGlobalSearch } from "@/lib/search/useGlobalSearch";
import { useSession } from "@/components/auth/SessionProvider";
import {
  addRecentSearch,
  clearRecentSearches,
  removeRecentSearch,
  useRecentSearches,
} from "@/lib/search/recentSearches";
import { ENTITY_ICON } from "@/lib/search/entityMeta";
import { QUICK_ACTIONS } from "@/lib/workspace/quickActions";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface PaletteRow {
  key: string;
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}

interface PaletteSection {
  heading: string;
  rows: PaletteRow[];
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const t = useTranslations("search");
  const tEntities = useTranslations("search.entities");
  const tActions = useTranslations("workspace.quickActions");
  const router = useRouter();
  const { user } = useSession();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const recentSearches = useRecentSearches();

  useFocusTrap(panelRef, open, onClose);

  const { groups, totalCount, isLoading, isError, recentDocuments, recentAnalyses } =
    useGlobalSearch(query);

  const hasQuery = query.trim().length > 0;

  const sections = useMemo<PaletteSection[]>(() => {
    if (!hasQuery) {
      const sections: PaletteSection[] = [
        {
          heading: t("quickActions"),
          rows: QUICK_ACTIONS.map((action) => ({
            key: `action:${action.key}`,
            href: action.href,
            icon: action.icon,
            title: tActions(action.key),
          })),
        },
      ];
      if (recentDocuments.length > 0) {
        sections.push({
          heading: t("recentDocuments"),
          rows: recentDocuments.map((item) => ({
            key: `${item.type}:${item.id}`,
            href: item.href,
            icon: ENTITY_ICON[item.type],
            title: item.title,
            subtitle: item.subtitle,
          })),
        });
      }
      if (recentAnalyses.length > 0) {
        sections.push({
          heading: t("recentAnalyses"),
          rows: recentAnalyses.map((item) => ({
            key: `${item.type}:${item.id}`,
            href: item.href,
            icon: ENTITY_ICON[item.type],
            title: item.title,
            subtitle: item.subtitle,
          })),
        });
      }
      return sections;
    }

    return groups.map((group) => ({
      heading: tEntities(group.type),
      rows: group.items.map((item) => ({
        key: `${item.type}:${item.id}`,
        href: item.href,
        icon: ENTITY_ICON[item.type],
        title: item.title,
        subtitle: item.subtitle,
      })),
    }));
  }, [hasQuery, groups, recentDocuments, recentAnalyses, t, tEntities, tActions]);

  const flatRows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);

  // Reset the active row whenever the visible row set changes shape, so a stale index
  // from a previous query doesn't point past the end of a shorter results list.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, flatRows.length]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  if (!open) return null;

  function go(href: string) {
    if (hasQuery) addRecentSearch(query, user.organizationId);
    onClose();
    router.push(href);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatRows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = flatRows[activeIndex];
      if (row) go(row.href);
    }
  }

  let rowIndex = -1;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto sm:p-4 sm:p-6">
      <div
        className="animate-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        tabIndex={-1}
        // Full-screen on mobile (no floating card at small sizes — design proposal §14's
        // standard command-palette responsive behavior); a centered, bounded card from
        // `sm:` up.
        className="animate-modal-panel relative z-10 flex h-full w-full flex-col overflow-hidden border border-hairline bg-surface shadow-elevated focus:outline-none sm:mt-[10vh] sm:h-auto sm:max-h-[80vh] sm:max-w-xl sm:rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-foreground-muted" strokeWidth={1.75} />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            aria-activedescendant={flatRows[activeIndex] ? `palette-option-${activeIndex}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t("placeholder")}
            className="h-6 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="shrink-0 rounded-md p-1 text-foreground-muted transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {!hasQuery && recentSearches.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-4 py-3">
            <History className="h-3.5 w-3.5 shrink-0 text-foreground-muted" strokeWidth={1.75} />
            {recentSearches.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuery(q)}
                className="group inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-2xs text-foreground-secondary transition-colors duration-150 hover:border-hairline-strong hover:text-foreground"
              >
                {q}
                <X
                  className="h-3 w-3 text-foreground-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  strokeWidth={2}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRecentSearch(q, user.organizationId);
                  }}
                />
              </button>
            ))}
            <button
              type="button"
              onClick={() => clearRecentSearches(user.organizationId)}
              className="ms-auto text-2xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground-secondary"
            >
              {t("clearRecent")}
            </button>
          </div>
        )}

        <div
          id="command-palette-listbox"
          role="listbox"
          className="scrollbar-thin flex-1 overflow-y-auto py-2 sm:max-h-[50vh] sm:flex-none"
        >
          {hasQuery && isLoading && (
            <div className="space-y-2.5 px-4 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                  <Skeleton className="h-3.5 w-40" />
                </div>
              ))}
            </div>
          )}

          {hasQuery && !isLoading && totalCount === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-hairline-strong bg-surface-2">
                <SearchX className="h-4.5 w-4.5 text-foreground-muted" strokeWidth={1.75} />
              </span>
              <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
              <p className="max-w-xs text-xs text-foreground-muted">
                {t("emptyDescription", { query })}
              </p>
            </div>
          )}

          {(!hasQuery || (!isLoading && totalCount > 0)) &&
            sections.map((section) => (
              <div key={section.heading} className="px-2 py-1.5">
                <p className="px-2.5 pb-1 text-2xs font-medium uppercase tracking-wider text-foreground-muted">
                  {section.heading}
                </p>
                {section.rows.map((row) => {
                  rowIndex += 1;
                  const isActive = rowIndex === activeIndex;
                  const optionId = `palette-option-${rowIndex}`;
                  const Icon = row.icon;
                  return (
                    <div
                      key={row.key}
                      id={optionId}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(rowIndex)}
                      onClick={() => go(row.href)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-100",
                        isActive ? "bg-accent-soft" : "hover:bg-white/[0.03]",
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2">
                        <Icon className="h-4 w-4 text-foreground-secondary" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{row.title}</span>
                        {row.subtitle && (
                          <span className="block truncate text-2xs text-foreground-muted">
                            {row.subtitle}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

          {hasQuery && isError && (
            <p className="px-4 py-2 text-2xs text-warning">{t("partialError")}</p>
          )}
        </div>

        <div className="hidden items-center gap-3 border-t border-hairline px-4 py-2 text-2xs text-foreground-muted sm:flex">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono">↑↓</kbd>
            {t("hintNavigate")}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono">↵</kbd>
            {t("hintOpen")}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono">esc</kbd>
            {t("hintClose")}
          </span>
        </div>
      </div>
    </div>
  );
}
