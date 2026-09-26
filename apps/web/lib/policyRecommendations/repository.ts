/**
 * Policy Recommendation repository behind a port, backed by PostgreSQL
 * (`policy_recommendations` table, 0030_policy_recommendations.sql). Tenant-scoped
 * (CLAUDE.md §20, default deny). Node-only.
 */

import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import type {
  LlmRecommendation,
  PolicyRecommendation,
  PolicyRecommendationStatus,
} from "./types";

export interface PolicyRecommendationRepository {
  list(tenantId: string): Promise<PolicyRecommendation[]>;
  get(tenantId: string, id: string): Promise<PolicyRecommendation | null>;
  /** Replaces every currently-`pending` recommendation with a fresh batch from a new analysis
   *  run — `drafted`/`dismissed` ones are a user's decision and are never touched by a re-run. */
  replacePending(
    tenantId: string,
    sourceAssessmentId: string | undefined,
    recommendations: LlmRecommendation[],
  ): Promise<PolicyRecommendation[]>;
  markDrafted(tenantId: string, id: string, createdPolicyId: string): Promise<PolicyRecommendation | null>;
  markDismissed(tenantId: string, id: string): Promise<PolicyRecommendation | null>;
}

interface Row {
  id: string;
  tenant_id: string;
  category: PolicyRecommendation["category"];
  title: string;
  reason: string;
  priority: PolicyRecommendation["priority"];
  is_regulatory_requirement: boolean;
  basis: string;
  related_requirement_or_risk: string | null;
  practical_guidance: string;
  recommended_contents: string[];
  references: string[];
  status: PolicyRecommendationStatus;
  created_policy_id: string | null;
  source_assessment_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: Row): PolicyRecommendation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    category: row.category,
    title: row.title,
    reason: row.reason,
    priority: row.priority,
    isRegulatoryRequirement: row.is_regulatory_requirement,
    basis: row.basis,
    relatedRequirementOrRisk: row.related_requirement_or_risk ?? undefined,
    practicalGuidance: row.practical_guidance,
    recommendedContents: row.recommended_contents,
    references: row.references,
    status: row.status,
    createdPolicyId: row.created_policy_id ?? undefined,
    sourceAssessmentId: row.source_assessment_id ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

class PostgresPolicyRecommendationRepository implements PolicyRecommendationRepository {
  async list(tenantId: string): Promise<PolicyRecommendation[]> {
    const { rows } = await getPool().query<Row>(
      `SELECT * FROM policy_recommendations WHERE tenant_id = $1
       ORDER BY
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC`,
      [tenantId],
    );
    return rows.map(toDomain);
  }

  async get(tenantId: string, id: string): Promise<PolicyRecommendation | null> {
    const { rows } = await getPool().query<Row>(
      `SELECT * FROM policy_recommendations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async replacePending(
    tenantId: string,
    sourceAssessmentId: string | undefined,
    recommendations: LlmRecommendation[],
  ): Promise<PolicyRecommendation[]> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM policy_recommendations WHERE tenant_id = $1 AND status = 'pending'`,
        [tenantId],
      );
      const now = new Date().toISOString();
      const inserted: PolicyRecommendation[] = [];
      for (const rec of recommendations) {
        const id = randomUUID();
        await client.query(
          `INSERT INTO policy_recommendations (
             id, tenant_id, category, title, reason, priority, is_regulatory_requirement, basis,
             related_requirement_or_risk, practical_guidance, recommended_contents, "references",
             status, source_assessment_id, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$14)`,
          [
            id,
            tenantId,
            rec.category,
            rec.title,
            rec.reason,
            rec.priority,
            rec.isRegulatoryRequirement,
            rec.basis,
            rec.relatedRequirementOrRisk ?? null,
            rec.practicalGuidance,
            JSON.stringify(rec.recommendedContents),
            JSON.stringify(rec.references),
            sourceAssessmentId ?? null,
            now,
          ],
        );
        inserted.push({
          id,
          tenantId,
          category: rec.category,
          title: rec.title,
          reason: rec.reason,
          priority: rec.priority,
          isRegulatoryRequirement: rec.isRegulatoryRequirement,
          basis: rec.basis,
          relatedRequirementOrRisk: rec.relatedRequirementOrRisk,
          practicalGuidance: rec.practicalGuidance,
          recommendedContents: rec.recommendedContents,
          references: rec.references,
          status: "pending",
          sourceAssessmentId,
          createdAt: now,
          updatedAt: now,
        });
      }
      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markDrafted(
    tenantId: string,
    id: string,
    createdPolicyId: string,
  ): Promise<PolicyRecommendation | null> {
    const { rows } = await getPool().query<Row>(
      `UPDATE policy_recommendations
       SET status = 'drafted', created_policy_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
       RETURNING *`,
      [tenantId, id, createdPolicyId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async markDismissed(tenantId: string, id: string): Promise<PolicyRecommendation | null> {
    const { rows } = await getPool().query<Row>(
      `UPDATE policy_recommendations
       SET status = 'dismissed', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
       RETURNING *`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }
}

export const policyRecommendationRepository: PolicyRecommendationRepository =
  new PostgresPolicyRecommendationRepository();
