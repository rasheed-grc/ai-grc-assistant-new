"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { FRAMEWORKS } from "@/lib/frameworks/catalog";
import { cn } from "@/lib/utils";

interface ControlPickerProps {
  value: string[];
  onChange: (controlIds: string[]) => void;
}

/** Multi-select of framework controls from the catalog, grouped by framework. */
export function ControlPicker({ value, onChange }: ControlPickerProps) {
  const t = useTranslations("common");
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(value), [value]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  const q = query.trim().toLowerCase();

  return (
    <div className="rounded-lg border border-hairline bg-surface/40">
      <div className="relative border-b border-hairline">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted"
          strokeWidth={1.75}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchControls")}
          className="h-9 w-full bg-transparent ps-8 pe-3 text-sm text-foreground outline-none placeholder:text-foreground-muted focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
        />
      </div>
      <div className="scrollbar-thin max-h-52 overflow-y-auto p-1.5">
        {FRAMEWORKS.map((framework) => {
          const controls = framework.controls.filter(
            (c) => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
          );
          if (controls.length === 0) return null;
          return (
            <div key={framework.id} className="mb-1.5">
              <p className="px-2 py-1 text-2xs font-medium uppercase tracking-wider text-foreground-muted">
                {framework.shortName}
              </p>
              {controls.map((control) => {
                const isSelected = selected.has(control.id);
                return (
                  <button
                    key={control.id}
                    type="button"
                    onClick={() => toggle(control.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors duration-150 hover:bg-white/[0.03]"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        isSelected
                          ? "border-accent bg-accent text-white"
                          : "border-hairline-strong",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-foreground">{control.code}</span>
                      <span className="ms-1.5 text-xs text-foreground-muted">{control.title}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
