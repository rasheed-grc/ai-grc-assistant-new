"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const t = useTranslations("common");
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, onClose);

  // Portals to document.body so the modal always covers the full viewport, regardless of
  // where it's invoked from. Without this, a modal rendered inside an ancestor that sets
  // `backdrop-filter`/`filter`/`transform` (e.g. Topbar's `backdrop-blur-xl`) would have its
  // `fixed inset-0` positioning scoped to that ancestor's box instead of the viewport — it
  // renders as a small panel pinned to that ancestor (the top nav) rather than a centered,
  // full-screen dialog. Mounting only after the initial client render avoids an SSR mismatch
  // (document.body doesn't exist on the server).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  return createPortal(
    // z-[60] is deliberately above Popover's z-50 (components/ui/Popover.tsx) so a modal
    // always renders above any open dropdown/menu — keep it higher if either scale changes.
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="animate-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "animate-modal-panel relative z-10 mt-8 w-full rounded-2xl border border-hairline bg-surface shadow-elevated focus:outline-none",
          size === "lg" ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="shrink-0 rounded-lg p-1 text-foreground-muted transition-colors duration-150 hover:bg-surface-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="scrollbar-thin max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
