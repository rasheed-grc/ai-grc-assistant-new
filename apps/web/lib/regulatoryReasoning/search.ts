/**
 * Regulatory Reasoning — multi-source search over the REAL, already-ingested regulatory corpus
 * (`regulation_sources` → `regulation_source_versions` → `regulation_documents` →
 * `regulation_sections`, populated by the KI-P6/ADR-0030 ingestion worker from the Saudi Board of
 * Experts law portal — apps/web/lib/db/migrations/0021_regulation_knowledge.sql). Deliberately
 * NOT a new/parallel data source: this reads the exact same tables the `/regulation-review`
 * admin-approval queue reads (`lib/regulationReview/*`), just from a different angle (search
 * instead of an approval worklist).
 *
 * Global, not tenant-scoped — these are national laws/regulations, identical for every tenant;
 * none of these tables carry a `tenant_id` column.
 *
 * Deliberately excludes `regulatory_obligations`/`regulatory_raw_documents` (the older Policy
 * Hunter/PI-P1 tables): inspecting the live database showed every row there is placeholder test
 * fixture data (`https://example.gov/<uuid>` URLs, the same boilerplate sentence repeated across
 * dozens of rows) — not real regulatory content. Citing it would mean inventing a source, which is
 * exactly what this module must never do.
 *
 * No vector index exists over this corpus (the review workflow's own docs note embeddings aren't
 * wired to retrieval yet), so this is real, live SQL keyword search — not a mock — ranked by how
 * many query keywords a section's Arabic text actually contains. Modest table size (~1,300
 * sections today) makes a sequential ILIKE scan fast enough with no index (CLAUDE.md's "no index
 * without a measured, proven need").
 */

import { arabicSearchTerms, needsArabicTranslation } from "./queryTranslation";
import { getPool } from "@/lib/db/pool";

export type RegulationDocumentType =
  | "law"
  | "executive_regulation"
  | "government_guide"
  | "standard"
  | "framework"
  | "policy"
  | "procedure"
  | "template"
  | "contract"
  | "internal_document"
  | "other";

export type RegulationVersionStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "published"
  | "superseded"
  | "withdrawn"
  | "archived"
  | "rejected";

export interface RegulatorySourceHit {
  sectionId: string;
  sectionTitleAr: string | null;
  sectionCode: string;
  textAr: string;
  sourceTitleAr: string;
  authority: string;
  documentType: RegulationDocumentType;
  status: RegulationVersionStatus;
  officialCitation: string | null;
  boeSourceUrl: string;
  matchCount: number;
}

/** Human labels for `document_type` — this is the نظام/لائحة/دليل/معيار distinction the product
 *  brief asks for. `decision` (قرار) and `circular` (تعميم) have no dedicated enum value in the
 *  schema today; sources of that nature currently fall under `other`, which is disclosed as-is
 *  rather than guessed at. */
export const DOCUMENT_TYPE_LABEL_AR: Record<RegulationDocumentType, string> = {
  law: "نظام",
  executive_regulation: "لائحة تنفيذية",
  government_guide: "دليل حكومي",
  standard: "معيار",
  framework: "إطار",
  policy: "سياسة",
  procedure: "إجراء",
  template: "قالب",
  contract: "عقد",
  internal_document: "مستند داخلي",
  other: "أخرى (قد يكون قرارًا أو تعميمًا لم يُصنَّف بعد)",
};

export const DOCUMENT_TYPE_LABEL_EN: Record<RegulationDocumentType, string> = {
  law: "Law",
  executive_regulation: "Executive Regulation",
  government_guide: "Government Guide",
  standard: "Standard",
  framework: "Framework",
  policy: "Policy",
  procedure: "Procedure",
  template: "Template",
  contract: "Contract",
  internal_document: "Internal Document",
  other: "Other (may be an unclassified decision/circular)",
};

/** Whether a version's status means a human has actually signed off on this text being fit to
 *  cite. `superseded`/`archived` are still real, once-authoritative text, so they are searchable
 *  and labeled honestly, just not implied to be CURRENTLY in force. */
export const APPROVED_STATUSES: RegulationVersionStatus[] = ["approved", "published"];

export const STATUS_LABEL_AR: Record<RegulationVersionStatus, string> = {
  draft: "مسودة أولية",
  in_review: "قيد المراجعة — لم تُعتمد بعد",
  approved: "معتمدة",
  published: "منشورة ومعتمدة",
  superseded: "نسخة سابقة استُبدلت بنسخة أحدث",
  withdrawn: "مسحوبة",
  archived: "مؤرشفة",
  rejected: "مرفوضة",
};

export const STATUS_LABEL_EN: Record<RegulationVersionStatus, string> = {
  draft: "initial draft",
  in_review: "pending human review — not yet approved",
  approved: "approved",
  published: "published and approved",
  superseded: "a prior version, since superseded",
  withdrawn: "withdrawn",
  archived: "archived",
  rejected: "rejected",
};

// Common Arabic function words carrying no topical meaning — filtered out before keyword
// matching so a question like "هل يجب علينا..." searches on its real subject, not "هل"/"على".
const ARABIC_STOPWORDS = new Set([
  "هل",
  "ما",
  "ماذا",
  "من",
  "في",
  "على",
  "إلى",
  "الى",
  "عن",
  "مع",
  "أن",
  "ان",
  "إن",
  "كل",
  "أو",
  "او",
  "لا",
  "لم",
  "لن",
  "قد",
  "كان",
  "هذا",
  "هذه",
  "ذلك",
  "التي",
  "الذي",
  "بحسب",
  "حسب",
  "نحن",
  "لدينا",
  "منشأتنا",
  "منشأتكم",
  "شركتنا",
  "هي",
  "هو",
  "يجب",
  "يتوجب",
  "بين",
  "عند",
  "كيف",
  "أين",
  "اين",
  "متى",
  "لماذا",
]);

function extractKeywords(query: string): string[] {
  const words = query
    .replace(/[؟?,.،؛;:!"'()«»]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !ARABIC_STOPWORDS.has(w));
  // De-duplicate while preserving first-seen order.
  return [...new Set(words)];
}

interface RegulationSectionRow {
  section_id: string;
  section_title_ar: string | null;
  section_code: string;
  text_ar: string;
  source_title_ar: string;
  authority: string;
  document_type: RegulationDocumentType;
  status: RegulationVersionStatus;
  official_citation: string | null;
  boe_source_url: string;
  match_count: string;
}

/**
 * Searches the regulatory corpus for sections relevant to `query`, ranked by keyword overlap.
 * Returns an empty array (never throws, never invents) when the question has no extractable
 * keywords or nothing matches — the caller is expected to say plainly that no source was found,
 * not to fall back to guessing.
 */
export async function searchRegulatorySources(
  query: string,
  limit = 6,
): Promise<RegulatorySourceHit[]> {
  // A non-Arabic question is searched through its Arabic equivalents (see queryTranslation.ts) —
  // the corpus is Arabic, so English keywords can never match it.
  const translated = await arabicSearchTerms(query);
  const keywords = needsArabicTranslation(query) ? translated : extractKeywords(query);
  if (keywords.length === 0) return [];

  const { rows } = await getPool().query<RegulationSectionRow>(
    `SELECT
       rsec.id AS section_id,
       rsec.title_ar AS section_title_ar,
       rsec.code AS section_code,
       rsec.text_ar AS text_ar,
       rs.title_ar AS source_title_ar,
       rs.authority AS authority,
       rs.document_type AS document_type,
       rsv.status AS status,
       rsv.official_citation AS official_citation,
       rs.boe_source_url AS boe_source_url,
       (SELECT count(*) FROM unnest($1::text[]) kw WHERE rsec.text_ar ILIKE '%' || kw || '%')
         AS match_count
     FROM regulation_sections rsec
     JOIN regulation_documents rd ON rd.id = rsec.document_id
     JOIN regulation_source_versions rsv ON rsv.id = rd.version_id
     JOIN regulation_sources rs ON rs.id = rsv.source_id
     WHERE rsec.text_ar IS NOT NULL
       AND rsv.status NOT IN ('rejected', 'withdrawn', 'draft')
       AND EXISTS (
         SELECT 1 FROM unnest($1::text[]) kw WHERE rsec.text_ar ILIKE '%' || kw || '%'
       )
     ORDER BY match_count DESC, rsec.position ASC
     LIMIT $2`,
    [keywords, limit],
  );

  return rows.map((row) => ({
    sectionId: row.section_id,
    sectionTitleAr: row.section_title_ar,
    sectionCode: row.section_code,
    textAr: row.text_ar,
    sourceTitleAr: row.source_title_ar,
    authority: row.authority,
    documentType: row.document_type,
    status: row.status,
    officialCitation: row.official_citation,
    boeSourceUrl: row.boe_source_url,
    matchCount: Number(row.match_count),
  }));
}
