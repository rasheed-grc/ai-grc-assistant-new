/**
 * Invitation repository, backed by PostgreSQL (`invitations`, 0024_access_onboarding.sql).
 * Node-only.
 */

import { getPool } from "@/lib/db/pool";
import type { Invitation, InvitedRole } from "./types";

export interface InvitationRepository {
  create(invitation: Invitation): Promise<Invitation>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  markUsed(id: string, usedAt: string): Promise<void>;
  /** Open (not used, not expired) team invites for one organization — the "pending" rows
   * shown alongside real members on the Settings team page. */
  listPendingForOrganization(organizationId: string): Promise<Invitation[]>;
  /** An open team invite already outstanding for this email within this organization, if
   * any — lets `inviteTeamMember` be idempotent instead of creating duplicate invites. */
  findPendingForOrganizationAndEmail(
    organizationId: string,
    email: string,
  ): Promise<Invitation | null>;
  /** Cancels an OPEN invite (its link stops working). False when there was no such open invite
   * in this organization — used already, expired, or someone else's. */
  revokePending(organizationId: string, invitationId: string): Promise<boolean>;
}

interface InvitationRow {
  id: string;
  email: string;
  organization_name: string;
  invited_role: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  access_request_id: string | null;
  organization_id: string | null;
  created_at: Date;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    organizationName: row.organization_name,
    invitedRole: row.invited_role as InvitedRole,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    accessRequestId: row.access_request_id,
    organizationId: row.organization_id,
    createdAt: row.created_at.toISOString(),
  };
}

class PostgresInvitationRepository implements InvitationRepository {
  async create(invitation: Invitation): Promise<Invitation> {
    await getPool().query(
      `INSERT INTO invitations
         (id, email, organization_name, invited_role, token_hash, expires_at, used_at,
          access_request_id, organization_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        invitation.id,
        invitation.email,
        invitation.organizationName,
        invitation.invitedRole,
        invitation.tokenHash,
        invitation.expiresAt,
        invitation.usedAt,
        invitation.accessRequestId,
        invitation.organizationId,
        invitation.createdAt,
      ],
    );
    return invitation;
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const { rows } = await getPool().query<InvitationRow>(
      `SELECT * FROM invitations WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ? toInvitation(rows[0]) : null;
  }

  async markUsed(id: string, usedAt: string): Promise<void> {
    await getPool().query(`UPDATE invitations SET used_at = $2 WHERE id = $1`, [id, usedAt]);
  }

  async listPendingForOrganization(organizationId: string): Promise<Invitation[]> {
    const { rows } = await getPool().query<InvitationRow>(
      `SELECT * FROM invitations
        WHERE organization_id = $1 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [organizationId],
    );
    return rows.map(toInvitation);
  }

  async findPendingForOrganizationAndEmail(
    organizationId: string,
    email: string,
  ): Promise<Invitation | null> {
    const { rows } = await getPool().query<InvitationRow>(
      `SELECT * FROM invitations
        WHERE organization_id = $1 AND lower(email) = lower($2)
          AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [organizationId, email],
    );
    return rows[0] ? toInvitation(rows[0]) : null;
  }

  async revokePending(organizationId: string, invitationId: string): Promise<boolean> {
    const { rowCount } = await getPool().query(
      `DELETE FROM invitations
        WHERE id = $1 AND organization_id = $2 AND used_at IS NULL`,
      [invitationId, organizationId],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const invitationRepository: InvitationRepository = new PostgresInvitationRepository();
