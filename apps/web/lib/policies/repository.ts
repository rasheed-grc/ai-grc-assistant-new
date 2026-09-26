/**
 * Policy repository behind a port, backed by PostgreSQL (`policies` table). Tenant-scoped
 * (CLAUDE.md §20, default deny). Node-only.
 */

import { getPool } from "@/lib/db/pool";
import type { Policy, PolicyGenerationMetadata, PolicyStatus } from "./types";

export interface PolicyRepository {
  list(tenantId: string): Promise<Policy[]>;
  get(tenantId: string, id: string): Promise<Policy | null>;
  create(policy: Policy): Promise<Policy>;
  update(tenantId: string, id: string, mutate: (policy: Policy) => Policy): Promise<Policy | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

interface PolicyRow {
  id: string;
  tenant_id: string;
  title: string;
  summary: string | null;
  body: string | null;
  status: PolicyStatus;
  owner_name: string;
  control_ids: string[];
  created_by_user_id: string;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
  approved_by_name: string | null;
  approved_at: Date | null;
  ai_generated: boolean;
  generated_by_tool: string | null;
  generation_metadata: PolicyGenerationMetadata | null;
}

function toPolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    summary: row.summary ?? undefined,
    body: row.body ?? undefined,
    status: row.status,
    ownerName: row.owner_name,
    controlIds: row.control_ids,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    approvedByName: row.approved_by_name ?? undefined,
    approvedAt: row.approved_at?.toISOString(),
    aiGenerated: row.ai_generated,
    generatedByTool: row.generated_by_tool ?? undefined,
    generationMetadata: row.generation_metadata ?? undefined,
  };
}

class PostgresPolicyRepository implements PolicyRepository {
  async list(tenantId: string): Promise<Policy[]> {
    const { rows } = await getPool().query<PolicyRow>(
      `SELECT * FROM policies WHERE tenant_id = $1 ORDER BY updated_at DESC`,
      [tenantId],
    );
    return rows.map(toPolicy);
  }

  async get(tenantId: string, id: string): Promise<Policy | null> {
    const { rows } = await getPool().query<PolicyRow>(
      `SELECT * FROM policies WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toPolicy(rows[0]) : null;
  }

  async create(policy: Policy): Promise<Policy> {
    await getPool().query(
      `INSERT INTO policies (
         id, tenant_id, title, summary, body, status, owner_name, control_ids,
         created_by_user_id, created_by_name, created_at, updated_at, approved_by_name, approved_at,
         ai_generated, generated_by_tool, generation_metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        policy.id,
        policy.tenantId,
        policy.title,
        policy.summary ?? null,
        policy.body ?? null,
        policy.status,
        policy.ownerName,
        JSON.stringify(policy.controlIds),
        policy.createdByUserId,
        policy.createdByName,
        policy.createdAt,
        policy.updatedAt,
        policy.approvedByName ?? null,
        policy.approvedAt ?? null,
        policy.aiGenerated ?? false,
        policy.generatedByTool ?? null,
        policy.generationMetadata ? JSON.stringify(policy.generationMetadata) : null,
      ],
    );
    return policy;
  }

  async update(
    tenantId: string,
    id: string,
    mutate: (policy: Policy) => Policy,
  ): Promise<Policy | null> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<PolicyRow>(
        `SELECT * FROM policies WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const updated = mutate(toPolicy(row));
      await client.query(
        `UPDATE policies SET
           title = $3, summary = $4, body = $5, status = $6, owner_name = $7, control_ids = $8,
           updated_at = $9, approved_by_name = $10, approved_at = $11
         WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          id,
          updated.title,
          updated.summary ?? null,
          updated.body ?? null,
          updated.status,
          updated.ownerName,
          JSON.stringify(updated.controlIds),
          updated.updatedAt,
          updated.approvedByName ?? null,
          updated.approvedAt ?? null,
        ],
      );
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const { rowCount } = await getPool().query(
      `DELETE FROM policies WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return (rowCount ?? 0) > 0;
  }
}

export const policyRepository: PolicyRepository = new PostgresPolicyRepository();
