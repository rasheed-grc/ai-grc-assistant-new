"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Library } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { InferredFramework } from "@/lib/planExecution/types";

/** `framework:nist_csf` → `NIST CSF`. Framework identifiers are acronyms, so this is the name. */
function frameworkName(frameworkId: string): string {
  return frameworkId.replace(/^framework:/, "").replace(/_/g, " ").toUpperCase();
}

/**
 * Section 9 (ADR 0066 §4): the ONLY place a framework is ever named. Sections 1–8 never say
 * "NIST" or "ISO 27001" — they say the business was analyzed against the best practices that
 * apply to it. Progressive disclosure, not concealment: fully populated, one click away
 * (CLAUDE.md §19's transparency requirement is met by availability, not prominence).
 */
export function MethodologySection({ frameworks }: { frameworks: InferredFramework[] }) {
  const t = useTranslations("governanceReport");
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Library className="h-4 w-4 text-accent-foreground" strokeWidth={1.75} />
        <h3 className="text-sm font-medium text-foreground">{t("methodology.title")}</h3>
      </div>
      {frameworks.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t("methodology.none")}</p>
      ) : (
        <>
          <p className="text-sm text-foreground-secondary">{t("methodology.description")}</p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-foreground-muted transition-colors duration-150 hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
              strokeWidth={1.75}
            />
            {t("methodology.toggle")}
          </button>
          {open && (
            <ul className="mt-3 space-y-2 border-t border-hairline pt-3">
              {frameworks.map((framework) => (
                <li key={framework.frameworkId} className="flex items-start justify-between gap-3 text-sm">
                  <span className="font-medium text-foreground" dir="ltr">
                    {frameworkName(framework.frameworkId)}
                  </span>
                  <Badge tone="neutral">{Math.round(framework.confidence * 100)}%</Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
