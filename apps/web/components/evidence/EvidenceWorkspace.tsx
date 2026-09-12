"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Download,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Tag,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { FavoriteButton } from "@/components/ui/FavoriteButton";
import { ControlPicker } from "@/components/evidence/ControlPicker";
import {
  useAddEvidenceVersion,
  useCreateEvidence,
  useDeleteEvidence,
  useEvidence,
  useEvidenceItem,
  useUpdateEvidence,
} from "@/hooks/useEvidence";
import { getControl } from "@/lib/frameworks/catalog";
import { EVIDENCE_ACCEPT } from "@/lib/evidence/validation";
import { currentVersion, type EvidenceSummary } from "@/lib/evidence/types";
import { recordVisit } from "@/lib/workspace/recentlyViewed";
import { useSession } from "@/components/auth/SessionProvider";
import { cn, formatBytes, formatDate } from "@/lib/utils";

interface Permissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export function EvidenceWorkspace(permissions: Permissions) {
  const t = useTranslations("evidenceWorkspace");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data: evidence, isLoading, isError } = useEvidence({ search: debounced });
  const searchParams = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const deleteEvidence = useDeleteEvidence();

  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId) setDetailId(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light debounce on the search box.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), 250);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
            strokeWidth={1.75}
          />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-full rounded-lg border border-hairline bg-surface/60 ps-9 pe-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-foreground-muted focus:border-hairline-strong focus:bg-surface-2"
          />
        </div>
        {permissions.canCreate && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t("addEvidence")}
          </button>
        )}
      </div>

      {isError ? (
        <Card>
          <div className="flex items-start gap-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{t("loadError")}</span>
          </div>
        </Card>
      ) : isLoading ? (
        <Card className="flex items-center justify-center gap-2 py-12 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {t("loading")}
        </Card>
      ) : !evidence || evidence.length === 0 ? (
        <Card grain className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline-strong bg-surface-2">
            <FileText className="h-5 w-5 text-foreground-muted" strokeWidth={1.75} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {debounced ? t("emptyMatchingTitle") : t("emptyTitle")}
            </p>
            <p className="text-xs text-foreground-muted">
              {debounced ? t("emptyMatchingHint") : t("emptyHint")}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {evidence.map((item) => (
            <EvidenceRow
              key={item.id}
              item={item}
              canDelete={permissions.canDelete}
              onOpen={() => setDetailId(item.id)}
              onDelete={() => deleteEvidence.mutate(item.id)}
            />
          ))}
        </div>
      )}

      {adding && <AddEvidenceModal onClose={() => setAdding(false)} />}
      {detailId && (
        <EvidenceDetailModal
          id={detailId}
          permissions={permissions}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const Icon = kind === "png" || kind === "jpg" ? ImageIcon : FileText;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-2">
      <Icon className="h-4 w-4 text-foreground-secondary" strokeWidth={1.75} />
    </span>
  );
}

function ControlChips({ controlIds }: { controlIds: string[] }) {
  const t = useTranslations("evidenceWorkspace");
  if (controlIds.length === 0)
    return <span className="text-2xs text-foreground-muted">{t("noLinkedControls")}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {controlIds.slice(0, 5).map((id) => {
        const control = getControl(id);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface/60 px-1.5 py-0.5 text-2xs text-foreground-secondary"
            title={control ? `${control.frameworkShortName} · ${control.title}` : id}
          >
            <span className="text-accent-foreground">{control?.frameworkShortName ?? "?"}</span>
            {control?.code ?? id}
          </span>
        );
      })}
      {controlIds.length > 5 && (
        <span className="text-2xs text-foreground-muted">+{controlIds.length - 5}</span>
      )}
    </div>
  );
}

function EvidenceRow({
  item,
  canDelete,
  onOpen,
  onDelete,
}: {
  item: EvidenceSummary;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("evidenceWorkspace");
  const [confirming, setConfirming] = useState(false);
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <FavoriteButton
        item={{
          id: item.id,
          type: "evidence",
          title: item.title,
          subtitle: item.currentVersion?.fileName,
          href: `/evidence?open=${item.id}`,
        }}
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-start"
      >
        <KindIcon kind={item.currentVersion?.kind ?? "file"} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ControlChips controlIds={item.controlIds} />
          </div>
        </div>
      </button>
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="hidden text-end sm:block">
          <p className="text-2xs text-foreground-muted">
            {t("versionSize", {
              count: item.versionCount,
              size: item.currentVersion ? formatBytes(item.currentVersion.sizeBytes) : "—",
            })}
          </p>
          <p className="text-2xs text-foreground-muted">
            {t("updatedOn", { date: formatDate(item.updatedAt) })}
          </p>
        </div>
        {item.tags.length > 0 && (
          <div className="hidden items-center gap-1 md:flex">
            <Tag className="h-3 w-3 text-foreground-muted" strokeWidth={1.75} />
            <span className="text-2xs text-foreground-muted">
              {item.tags.slice(0, 3).join(", ")}
            </span>
          </div>
        )}
        <div className="ms-auto flex items-center gap-1 sm:ms-0">
          {item.currentVersion && (
            <a
              href={`/api/evidence/${item.id}/versions/current/content?download`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface/60 text-foreground-muted transition-colors duration-150 hover:border-hairline-strong hover:text-foreground"
              title={t("downloadCurrentVersion")}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            </a>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => {
                if (confirming) onDelete();
                else {
                  setConfirming(true);
                  setTimeout(() => setConfirming(false), 3000);
                }
              }}
              className={cn(
                "inline-flex h-7 items-center justify-center rounded-md border px-2 text-2xs font-medium transition-colors duration-150",
                confirming
                  ? "border-danger/40 bg-danger-soft text-danger"
                  : "border-hairline bg-surface/60 text-foreground-muted hover:border-hairline-strong hover:text-foreground",
              )}
              title={t("delete")}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {confirming && <span className="ms-1">{t("confirm")}</span>}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const t = useTranslations("evidenceWorkspace");
  const [draft, setDraft] = useState("");
  function commit() {
    const value = draft.trim().toLowerCase();
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setDraft("");
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-hairline bg-surface/60 px-2 py-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-2xs text-accent-foreground"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((existing) => existing !== tag))}
            aria-label={t("removeTag", { tag })}
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={tags.length ? "" : t("addTagsPlaceholder")}
        className="min-w-[80px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
      />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">{children}</span>
  );
}

function AddEvidenceModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("evidenceWorkspace");
  const create = useCreateEvidence();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [controlIds, setControlIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError(t("errorTitleRequired"));
    if (!file) return setError(t("errorFileRequired"));
    try {
      await create.mutateAsync({ title, description, tags, controlIds, file });
      onClose();
    } catch {
      setError(t("errorAddFailed"));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("addEvidence")}
      description={t("addEvidenceDescription")}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground-secondary hover:text-foreground"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            form="add-evidence-form"
            disabled={create.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow hover:opacity-90 disabled:opacity-60"
          >
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            {t("saveEvidence")}
          </button>
        </>
      }
    >
      <form id="add-evidence-form" onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}
        <label className="block">
          <FieldLabel>{t("fieldTitle")}</FieldLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            className="h-9 w-full rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground outline-none focus:border-hairline-strong"
          />
        </label>
        <label className="block">
          <FieldLabel>{t("fieldDescription")}</FieldLabel>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-hairline bg-surface/60 px-3 py-2 text-sm text-foreground outline-none focus:border-hairline-strong"
          />
        </label>
        <div>
          <FieldLabel>{t("fieldTags")}</FieldLabel>
          <TagInput tags={tags} onChange={setTags} />
        </div>
        <div>
          <FieldLabel>{t("fieldLinkedControls")}</FieldLabel>
          <ControlPicker value={controlIds} onChange={setControlIds} />
        </div>
        <div>
          <FieldLabel>{t("fieldFile")}</FieldLabel>
          <input
            type="file"
            accept={EVIDENCE_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-foreground-secondary file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-surface-hover"
          />
          <p className="mt-1 text-2xs text-foreground-muted">{t("fileHint")}</p>
        </div>
      </form>
    </Modal>
  );
}

function EvidenceDetailModal({
  id,
  permissions,
  onClose,
}: {
  id: string;
  permissions: Permissions;
  onClose: () => void;
}) {
  const t = useTranslations("evidenceWorkspace");
  const { user } = useSession();
  const { data: evidence, isLoading, isError, isFetching } = useEvidenceItem(id);
  const addVersion = useAddEvidenceVersion();
  const updateEvidence = useUpdateEvidence();
  const [editingControls, setEditingControls] = useState(false);
  const [draftControls, setDraftControls] = useState<string[]>([]);
  const versionInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!evidence) return;
    recordVisit(
      {
        id: evidence.id,
        type: "evidence",
        title: evidence.title,
        subtitle: currentVersion(evidence)?.fileName,
        href: `/evidence?open=${evidence.id}`,
      },
      user.organizationId,
    );
  }, [evidence, user.organizationId]);

  async function onPickVersion(file: File | undefined) {
    if (!file) return;
    await addVersion.mutateAsync({ id, file });
  }

  return (
    <Modal open onClose={onClose} title={evidence?.title ?? t("evidenceFallbackTitle")} size="lg">
      {isError || (!evidence && !isFetching) ? (
        <div className="flex items-start gap-2 py-10 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{t("loadError")}</span>
        </div>
      ) : isLoading || !evidence ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {t("loadingEllipsis")}
        </div>
      ) : (
        <div className="space-y-5">
          {evidence.description && (
            <p className="text-sm text-foreground-secondary">{evidence.description}</p>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-foreground-secondary">
                {t("linkedControls")}
              </p>
              {permissions.canUpdate && !editingControls && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftControls(evidence.controlIds);
                    setEditingControls(true);
                  }}
                  className="text-2xs text-accent-foreground hover:underline"
                >
                  {t("edit")}
                </button>
              )}
            </div>
            {editingControls ? (
              <div className="space-y-2">
                <ControlPicker value={draftControls} onChange={setDraftControls} />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingControls(false)}
                    className="h-8 rounded-lg border border-hairline px-2.5 text-2xs text-foreground-secondary"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await updateEvidence.mutateAsync({
                        id,
                        patch: { controlIds: draftControls },
                      });
                      setEditingControls(false);
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent px-2.5 text-2xs font-medium text-white"
                  >
                    {updateEvidence.isPending && (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    )}
                    {t("saveLinks")}
                  </button>
                </div>
              </div>
            ) : (
              <ControlChips controlIds={evidence.controlIds} />
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-medium text-foreground-secondary">
                <History className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t("versionHistory", { count: evidence.versions.length })}
              </p>
              {permissions.canUpdate && (
                <>
                  <button
                    type="button"
                    onClick={() => versionInput.current?.click()}
                    disabled={addVersion.isPending}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-surface/60 px-2.5 text-2xs font-medium text-foreground-secondary hover:border-hairline-strong hover:text-foreground disabled:opacity-60"
                  >
                    {addVersion.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    {t("newVersion")}
                  </button>
                  <input
                    ref={versionInput}
                    type="file"
                    accept={EVIDENCE_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      void onPickVersion(e.target.files?.[0] ?? undefined);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
            </div>
            <div className="space-y-1.5">
              {[...evidence.versions].reverse().map((version) => (
                <div
                  key={version.id}
                  className="flex items-center gap-3 rounded-lg border border-hairline bg-surface/40 px-3 py-2"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md border border-hairline bg-surface-2 text-2xs font-semibold text-foreground-secondary">
                    v{version.versionNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{version.fileName}</p>
                    <p className="text-2xs text-foreground-muted">
                      {formatBytes(version.sizeBytes)} · {version.uploadedByName} ·{" "}
                      {formatDate(version.createdAt)}
                      {version.id === evidence.currentVersionId && ` · ${t("current")}`}
                    </p>
                  </div>
                  <a
                    href={`/api/evidence/${id}/versions/${version.id}/content?download`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface/60 text-foreground-muted hover:border-hairline-strong hover:text-foreground"
                    title={t("download")}
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
