"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Loader2, Mail, Plus, TriangleAlert, UserRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useSession } from "@/components/auth/SessionProvider";
import { useInviteTeamMember, useOrganizationTeam } from "@/hooks/useOrganizations";
import { INVITED_ROLES, type InvitedRole } from "@/lib/invitations/types";
import { cn, formatDate } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-hairline bg-surface/60 px-3 text-sm text-foreground outline-none focus:border-hairline-strong";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-foreground-secondary">{children}</span>
  );
}

export function TeamManagement() {
  const t = useTranslations("teamManagement");
  const { hasRole } = useSession();
  const canInvite = hasRole("owner", "admin");
  const { data, isLoading, isError } = useOrganizationTeam();
  const [inviting, setInviting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t("title")}
            {data ? ` · ${data.members.length}` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-foreground-secondary">{t("subtitle")}</p>
        </div>
        {canInvite && (
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t("inviteButton")}
          </button>
        )}
      </div>

      {isLoading ? (
        <Card>
          <p className="text-sm text-foreground-secondary">{t("loading")}</p>
        </Card>
      ) : isError ? (
        <Card>
          <div className="flex items-start gap-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{t("loadError")}</span>
          </div>
        </Card>
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-start text-2xs uppercase tracking-wider text-foreground-muted">
                  <th className="px-5 py-2.5 font-medium">{t("table.member")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("table.role")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("table.status")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("table.since")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.members.map((member) => (
                  <tr key={member.userId} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-foreground">
                          <UserRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{member.name}</p>
                          <p className="truncate text-2xs text-foreground-muted">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-foreground-secondary">
                      {t(`roles.${member.role}`)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="success" dot>
                        {t("statusActive")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-2xs text-foreground-muted">
                      {formatDate(member.joinedAt)}
                    </td>
                  </tr>
                ))}
                {data?.pendingInvitations.map((invite) => (
                  <tr key={invite.id} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-hairline-strong text-2xs text-foreground-muted">
                          <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        <p className="truncate font-medium text-foreground-secondary">
                          {invite.email}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-foreground-secondary">
                      {t(`roles.${invite.invitedRole}`)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="warning" dot>
                        {t("statusPending")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-2xs text-foreground-muted">
                      {formatDate(invite.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {inviting && <InviteMemberModal onClose={() => setInviting(false)} />}
    </div>
  );
}

function InviteMemberModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("teamManagement");
  const invite = useInviteTeamMember();
  const [email, setEmail] = useState("");
  const [invitedRole, setInvitedRole] = useState<InvitedRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inviteLink: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t("errors.emailRequired"));
      return;
    }
    try {
      const response = await invite.mutateAsync({ email: email.trim(), invitedRole });
      setResult({ inviteLink: response.inviteLink, emailSent: response.emailSent });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("errors.inviteFailed"));
    }
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result) {
    return (
      <Modal
        open
        onClose={onClose}
        title={t("modal.successTitle")}
        footer={
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-glow hover:opacity-90 active:scale-[0.98]"
          >
            {t("done")}
          </button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-hairline bg-surface-elevated p-3">
            <p className="text-xs font-medium text-foreground-secondary">{t("inviteLinkLabel")}</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={result.inviteLink}
                className="h-9 flex-1 truncate rounded-lg border border-hairline bg-surface px-3 text-xs text-foreground"
                dir="ltr"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-xs font-medium text-foreground-secondary transition-colors hover:bg-surface-elevated"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
            <p className="mt-2 text-2xs text-foreground-muted">{t("inviteLinkHint")}</p>
          </div>
          {result.emailSent ? (
            <p className="flex items-center gap-1.5 text-2xs text-success">
              <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("emailSent", { email })}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-2xs text-warning">
              <TriangleAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("emailNotSent")}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("modal.inviteTitle")}
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
            form="invite-team-member-form"
            disabled={invite.isPending}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-glow hover:opacity-90 active:scale-[0.98]",
              invite.isPending && "opacity-60",
            )}
          >
            {invite.isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            {t("sendInvite")}
          </button>
        </>
      }
    >
      <form id="invite-team-member-form" onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}
        <label className="block">
          <FieldLabel>{t("form.email")}</FieldLabel>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("form.emailPlaceholder")}
            className={cn(inputClass, "h-9")}
          />
        </label>
        <label className="block">
          <FieldLabel>{t("form.role")}</FieldLabel>
          <select
            value={invitedRole}
            onChange={(e) => setInvitedRole(e.target.value as InvitedRole)}
            className={cn(inputClass, "h-9")}
          >
            {INVITED_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  );
}
