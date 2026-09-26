-- Policy Recommendations (Policies Intelligence, V2): a persisted, tenant-scoped recommendation
-- an "Analyze Policy Needs" run produces from real context (governance-program answers, the
-- sector's applicable questions, identified risks, existing policies, and any matching regulatory
-- sources) — never a hardcoded per-sector list. Deliberately its own table rather than a new
-- column on `policies`: a recommendation is not yet a policy — most are dismissed or superseded by
-- the next analysis run before ever becoming one, and `policies` gets a real row (via
-- `created_policy_id`) only once a user turns a recommendation into a draft.
CREATE TABLE IF NOT EXISTS policy_recommendations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  priority text NOT NULL,
  is_regulatory_requirement boolean NOT NULL DEFAULT false,
  basis text NOT NULL,
  related_requirement_or_risk text,
  practical_guidance text NOT NULL,
  recommended_contents jsonb NOT NULL DEFAULT '[]',
  "references" jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  created_policy_id text REFERENCES policies (id) ON DELETE SET NULL,
  source_assessment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_recommendations_category_check CHECK (
    category IN ('general', 'sector', 'establishment')
  ),
  CONSTRAINT policy_recommendations_priority_check CHECK (
    priority IN ('critical', 'high', 'medium', 'low')
  ),
  CONSTRAINT policy_recommendations_status_check CHECK (
    status IN ('pending', 'drafted', 'dismissed')
  ),
  -- A recommendation only carries a policy once it has actually been turned into one.
  CONSTRAINT policy_recommendations_drafted_has_policy CHECK (
    (status = 'drafted') = (created_policy_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS policy_recommendations_tenant_idx ON policy_recommendations (tenant_id);
CREATE INDEX IF NOT EXISTS policy_recommendations_tenant_status_idx
  ON policy_recommendations (tenant_id, status);

COMMENT ON COLUMN policy_recommendations.basis IS
  'The specific fact grounding this recommendation: a governance answer, an identified risk, or a
   regulatory excerpt reference — never left implicit, so the recommendation stays traceable back
   to what produced it.';
COMMENT ON COLUMN policy_recommendations.is_regulatory_requirement IS
  'true only when `references` cites an actual regulatory excerpt that states this obligation;
   false means the recommendation is a best-practice suggestion, not a cited legal requirement —
   the UI must never blur this distinction.';
