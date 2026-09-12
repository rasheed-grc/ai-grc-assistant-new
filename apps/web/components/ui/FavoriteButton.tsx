"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { toggleFavorite, useIsFavorite, type FavoriteItem } from "@/lib/workspace/favorites";
import { useSession } from "@/components/auth/SessionProvider";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  item: Omit<FavoriteItem, "savedAt">;
  className?: string;
}

/** Star toggle for the Saved/Favorite Items feature (V2-P3 Milestone 6, design proposal
 *  §9). Kept as a small, self-contained affordance so it drops into an existing row
 *  without touching that row's layout — favorited state uses `--accent`, never the
 *  decorative-only `--gold` (DESIGN_SYSTEM.md's gold usage rule). */
export function FavoriteButton({ item, className }: FavoriteButtonProps) {
  const t = useTranslations("workspace.favoriteButton");
  const { user } = useSession();
  const isFavorite = useIsFavorite(item.type, item.id);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite(item, user.organizationId);
      }}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? t("remove") : t("add")}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors duration-150 hover:bg-accent-soft hover:text-accent-foreground",
        isFavorite && "text-accent-foreground",
        className,
      )}
    >
      <Star className="h-3.5 w-3.5" strokeWidth={1.75} fill={isFavorite ? "currentColor" : "none"} />
    </button>
  );
}
