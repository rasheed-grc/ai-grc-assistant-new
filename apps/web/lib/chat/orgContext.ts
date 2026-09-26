/**
 * The assistant's live organization context — real, tenant-scoped facts about the CURRENT
 * organization's governance program, policies, risks, and framework coverage, gathered through
 * the same services the rest of the product already reads from (never a separate/duplicated query
 * path, never mock data).
 *
 * This is deliberately NOT retrieval: it is small, bounded, and always included, the same way a
 * human advisor already knows their client's file before a call starts. Document excerpts stay a
 * separate, relevance-filtered context block (`retrieve()` in `service.ts`) — the two are combined
 * in `buildMessages`, not merged into one.
 *
 * Every section renders "no data yet" rather than omitting itself silently, so the model is never
 * left to guess whether something is empty or simply wasn't fetched (CLAUDE.md §29: insufficient
 * information must be stated, never invented).
 */

import { getTranslations } from "next-intl/server";
import type { ActorContext } from "@/lib/auth/actor";
import { getProgramStatus } from "@/lib/planExecution/programStatus";
import { computeCoverage } from "@/lib/governance/coverage";
import { listRisks } from "@/lib/risk/service";
import { policyRepository } from "@/lib/policies/repository";
import { documentRepository } from "@/lib/documents/repository";
import type { AppLocale } from "@/i18n/routing";
import type { PlanItem } from "@/lib/planExecution/types";
import type { Risk } from "@/lib/risk/types";
import type { Policy } from "@/lib/policies/types";
import type { DocumentRecord } from "@/lib/documents/types";

const MAX_OPEN_ITEMS = 5;
const MAX_LISTED_DOCUMENTS = 15;

const PRIORITY_RANK: Record<PlanItem["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function isOpen(item: PlanItem): boolean {
  return item.status === "not_started" || item.status === "in_progress";
}

function formatDate(epochSeconds: number | null, locale: AppLocale): string {
  if (epochSeconds == null) return locale === "ar" ? "بدون موعد" : "no due date";
  return new Date(epochSeconds * 1000).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function governanceSection(
  status: Awaited<ReturnType<typeof getProgramStatus>>,
  locale: AppLocale,
): string {
  if (status.state === "none" || status.plan === null) {
    return locale === "ar"
      ? "برنامج الحوكمة: لم يبدأ المستخدم هذا البرنامج بعد — لا توجد بيانات تقييم أو خطة."
      : "Governance Program: not started yet — no assessment or plan exists.";
  }

  const openItems = status.plan.items
    .filter(isOpen)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, MAX_OPEN_ITEMS);

  const header =
    locale === "ar"
      ? `برنامج الحوكمة: نشط (الإصدار ${status.version}), عدد المهام غير المنجزة: ` +
        `${status.plan.items.filter(isOpen).length} من ${status.plan.items.length}.` +
        (status.state === "reviewDue" ? " المراجعة الدورية مستحقة الآن." : "")
      : `Governance Program: active (v${status.version}), ` +
        `${status.plan.items.filter(isOpen).length} of ${status.plan.items.length} tasks open.` +
        (status.state === "reviewDue" ? " A periodic review is due now." : "");

  if (openItems.length === 0) return header;

  const lines = openItems.map((item) =>
    locale === "ar"
      ? `  - [${item.priority}] ${item.title} — الاستحقاق: ${formatDate(item.dueAt, locale)}`
      : `  - [${item.priority}] ${item.title} — due ${formatDate(item.dueAt, locale)}`,
  );

  return `${header}\n${lines.join("\n")}`;
}

function policiesSection(policies: Policy[], locale: AppLocale): string {
  if (policies.length === 0) {
    return locale === "ar" ? "السياسات: لا توجد سياسات مسجلة لهذه المنشأة بعد." : "Policies: none recorded for this organization yet.";
  }
  const byStatus = new Map<string, number>();
  for (const policy of policies) {
    byStatus.set(policy.status, (byStatus.get(policy.status) ?? 0) + 1);
  }
  const breakdown = [...byStatus.entries()].map(([status, count]) => `${status}: ${count}`).join(", ");
  return locale === "ar"
    ? `السياسات: ${policies.length} سياسة إجمالاً (${breakdown}).`
    : `Policies: ${policies.length} total (${breakdown}).`;
}

function risksSection(risks: Risk[], locale: AppLocale): string {
  if (risks.length === 0) {
    return locale === "ar" ? "المخاطر: لا توجد مخاطر مسجلة لهذه المنشأة بعد." : "Risks: none recorded for this organization yet.";
  }
  const open = risks.filter((r) => r.status === "open" || r.status === "mitigating").length;
  return locale === "ar"
    ? `المخاطر: ${risks.length} خطرًا إجمالاً، منها ${open} مفتوح أو قيد المعالجة.`
    : `Risks: ${risks.length} total, ${open} open or under mitigation.`;
}

/**
 * The DOCUMENT LIST — metadata only (filename, category, processing status, upload date), never
 * content. This is what lets the assistant answer "what have I uploaded?" or "is X indexed yet?"
 * without pulling any document into the prompt. Content only ever enters the prompt through
 * `retrieve()`'s relevance-filtered chunk search in `service.ts` — a document appearing here does
 * NOT mean its content is available to quote; only a `processed` document has been chunked and
 * embedded (`lib/analysis/service.ts`'s pipeline), so only those are actually searchable.
 */
async function documentsSection(
  documents: DocumentRecord[],
  locale: AppLocale,
): Promise<string> {
  if (documents.length === 0) {
    return locale === "ar"
      ? "المستندات: لا توجد مستندات مرفوعة لهذه المنشأة بعد."
      : "Documents: none uploaded for this organization yet.";
  }

  const [tCategory, tStatus] = await Promise.all([
    getTranslations({ locale, namespace: "documentCategories" }),
    getTranslations({ locale, namespace: "documentStatus" }),
  ]);

  const processedCount = documents.filter((d) => d.status === "processed").length;
  const header =
    locale === "ar"
      ? `المستندات: ${documents.length} مستندًا مرفوعًا إجمالاً، منها ${processedCount} ` +
        `تمت معالجته وأصبح محتواه قابلاً للاسترجاع (البقية موجودة لكن غير مفهرسة بعد أو فشلت معالجتها).`
      : `Documents: ${documents.length} uploaded total, ${processedCount} processed and ` +
        `content-searchable (the rest exist but are not yet indexed, or failed processing).`;

  const listed = documents.slice(0, MAX_LISTED_DOCUMENTS);
  const lines = listed.map((doc) => {
    const category = tCategory.has(doc.category as never) ? tCategory(doc.category as never) : doc.category;
    const status = tStatus.has(doc.status as never) ? tStatus(doc.status as never) : doc.status;
    return locale === "ar"
      ? `  - "${doc.fileName}" (${category}) — الحالة: ${status}، تاريخ الرفع: ${formatDate(
          Math.floor(new Date(doc.createdAt).getTime() / 1000),
          locale,
        )}`
      : `  - "${doc.fileName}" (${category}) — status: ${status}, uploaded: ${formatDate(
          Math.floor(new Date(doc.createdAt).getTime() / 1000),
          locale,
        )}`;
  });

  const truncationNote =
    documents.length > MAX_LISTED_DOCUMENTS
      ? locale === "ar"
        ? `\n  (و${documents.length - MAX_LISTED_DOCUMENTS} مستندًا إضافيًا لم يُدرج هنا)`
        : `\n  (and ${documents.length - MAX_LISTED_DOCUMENTS} more not listed here)`
      : "";

  return `${header}\n${lines.join("\n")}${truncationNote}`;
}

function coverageSection(
  coverage: Awaited<ReturnType<typeof computeCoverage>>,
  locale: AppLocale,
): string {
  if (coverage.frameworks.length === 0) {
    return locale === "ar" ? "تغطية الأطر: لا توجد أطر مفعّلة بعد." : "Framework coverage: no frameworks active yet.";
  }
  const lines = coverage.frameworks.map((f) => `  - ${f.shortName}: ${f.coveragePct}%`);
  return (locale === "ar" ? "تغطية الأطر:" : "Framework coverage:") + `\n${lines.join("\n")}`;
}

/**
 * Builds the compact, always-included organization context block. Every field is fetched
 * tenant-scoped through `actor` — nothing here can cross into another organization's data.
 */
export async function buildOrganizationContext(actor: ActorContext, locale: AppLocale): Promise<string> {
  const [status, coverage, risks, policies, documents] = await Promise.all([
    getProgramStatus(actor),
    computeCoverage(actor),
    listRisks(actor),
    policyRepository.list(actor.tenantId),
    documentRepository.list(actor.tenantId),
  ]);

  const documentsBlock = await documentsSection(documents, locale);

  return [
    governanceSection(status, locale),
    policiesSection(policies, locale),
    risksSection(risks, locale),
    documentsBlock,
    coverageSection(coverage, locale),
  ].join("\n\n");
}
