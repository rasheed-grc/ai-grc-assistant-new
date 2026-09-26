/**
 * Organization + membership repository, backed by PostgreSQL (`organizations` +
 * `user_organizations`). A user can belong to more than one organization; membership is
 * the join table a session's active `organizationId` is validated against on switch.
 * Node-only.
 */

import { getPool } from "@/lib/db/pool";
import type { Organization, OrganizationMember, OrganizationMembership } from "./types";

export interface OrganizationRepository {
  listForUser(userId: string): Promise<OrganizationMembership[]>;
  get(organizationId: string): Promise<Organization | null>;
  getMembership(userId: string, organizationId: string): Promise<OrganizationMembership | null>;
  isMember(userId: string, organizationId: string): Promise<boolean>;
  create(org: Organization): Promise<Organization>;
  /** Partial update of an existing organization's own fields (never membership/role rows). */
  update(
    organizationId: string,
    patch: Partial<Pick<Organization, "name" | "orgType" | "industry">>,
  ): Promise<Organization | null>;
  addMember(userId: string, organizationId: string, role: string): Promise<void>;
  /** Every real member of one organization, for the Settings > Team page. */
  listMembers(organizationId: string): Promise<OrganizationMember[]>;
}

interface OrganizationRow {
  id: string;
  name: string;
  org_type: string;
  industry: string;
  created_by_user_id: string;
  created_at: Date;
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    orgType: row.org_type,
    industry: row.industry,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

class PostgresOrganizationRepository implements OrganizationRepository {
  async listForUser(userId: string): Promise<OrganizationMembership[]> {
    const { rows } = await getPool().query<OrganizationRow & { role: string }>(
      `SELECT o.*, m.role FROM organizations o
       JOIN user_organizations m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY m.created_at ASC`,
      [userId],
    );
    return rows.map((row) => ({ ...toOrganization(row), role: row.role }));
  }

  async get(organizationId: string): Promise<Organization | null> {
    const { rows } = await getPool().query<OrganizationRow>(
      `SELECT * FROM organizations WHERE id = $1`,
      [organizationId],
    );
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async getMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    const { rows } = await getPool().query<OrganizationRow & { role: string }>(
      `SELECT o.*, m.role FROM organizations o
       JOIN user_organizations m ON m.organization_id = o.id
       WHERE m.user_id = $1 AND m.organization_id = $2`,
      [userId, organizationId],
    );
    const row = rows[0];
    return row ? { ...toOrganization(row), role: row.role } : null;
  }

  async isMember(userId: string, organizationId: string): Promise<boolean> {
    const { rows } = await getPool().query(
      `SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId],
    );
    return rows.length > 0;
  }

  async create(org: Organization): Promise<Organization> {
    await getPool().query(
      `INSERT INTO organizations (id, name, org_type, industry, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [org.id, org.name, org.orgType, org.industry, org.createdByUserId, org.createdAt],
    );
    return org;
  }

  async update(
    organizationId: string,
    patch: Partial<Pick<Organization, "name" | "orgType" | "industry">>,
  ): Promise<Organization | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      values.push(patch.name);
      sets.push(`name = $${values.length}`);
    }
    if (patch.orgType !== undefined) {
      values.push(patch.orgType);
      sets.push(`org_type = $${values.length}`);
    }
    if (patch.industry !== undefined) {
      values.push(patch.industry);
      sets.push(`industry = $${values.length}`);
    }
    if (sets.length === 0) return this.get(organizationId);

    values.push(organizationId);
    const { rows } = await getPool().query<OrganizationRow>(
      `UPDATE organizations SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async addMember(userId: string, organizationId: string, role: string): Promise<void> {
    await getPool().query(
      `INSERT INTO user_organizations (user_id, organization_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, organization_id) DO NOTHING`,
      [userId, organizationId, role],
    );
  }

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const { rows } = await getPool().query<{
      user_id: string;
      name: string;
      email: string;
      role: string;
      created_at: Date;
    }>(
      `SELECT u.id AS user_id, u.name, u.email, m.role, m.created_at
         FROM user_organizations m
         JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY m.created_at ASC`,
      [organizationId],
    );
    return rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role,
      joinedAt: row.created_at.toISOString(),
    }));
  }
}

export const organizationRepository: OrganizationRepository = new PostgresOrganizationRepository();
