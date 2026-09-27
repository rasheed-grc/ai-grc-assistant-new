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
import { can } from "@/lib/auth/permissions";
import { ROLE_META, primaryRole } from "@/lib/auth/roles";
import { listMissions } from "@/lib/missions/service";
import { toRiskSummary } from "@/lib/risk/types";
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

  const doneItems = status.plan.items.filter((item) => item.status === "done").slice(0, MAX_OPEN_ITEMS);
  const doneBlock =
    doneItems.length === 0
      ? ""
      : `\n${locale === "ar" ? "المهام المنجزة:" : "Completed tasks:"}\n` +
        doneItems.map((item) => `  - ${item.title}`).join("\n");

  if (openItems.length === 0) return `${header}${doneBlock}`;

  const lines = openItems.map((item) =>
    locale === "ar"
      ? `  - [${item.priority}] ${item.title} — الاستحقاق: ${formatDate(item.dueAt, locale)}`
      : `  - [${item.priority}] ${item.title} — due ${formatDate(item.dueAt, locale)}`,
  );

  return `${header}\n${lines.join("\n")}${doneBlock}`;
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
  const titles = policies
    .slice(0, 8)
    .map((p) => `  - ${p.title} (${p.status})`)
    .join("\n");
  return locale === "ar"
    ? `السياسات: ${policies.length} سياسة إجمالاً (${breakdown}).\n${titles}`
    : `Policies: ${policies.length} total (${breakdown}).\n${titles}`;
}

function risksSection(risks: Risk[], locale: AppLocale): string {
  if (risks.length === 0) {
    return locale === "ar" ? "المخاطر: لا توجد مخاطر مسجلة لهذه المنشأة بعد." : "Risks: none recorded for this organization yet.";
  }
  const open = risks.filter((r) => r.status === "open" || r.status === "mitigating").length;
  const top = risks
    .map(toRiskSummary)
    .sort((a, b) => b.inherentScore - a.inherentScore)
    .slice(0, 5)
    .map((r) => `  - ${r.title} (${r.severity}, ${r.status})`)
    .join("\n");
  return locale === "ar"
    ? `المخاطر: ${risks.length} خطرًا إجمالاً، منها ${open} مفتوح أو قيد المعالجة. الأعلى درجة:\n${top}`
    : `Risks: ${risks.length} total, ${open} open or under mitigation. Highest scoring:\n${top}`;
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

/** Who is asking, and what they may do — so "can I publish this policy?" or "what's my role?" is
 * answered from the real permission matrix (`lib/auth/permissions.ts`, the same one the server
 * enforces), never guessed. */
function identitySection(actor: ActorContext, locale: AppLocale): string {
  const role = primaryRole(actor.roles);
  const roleLabel = role ? ROLE_META[role].label : "none";
  const isAdmin = actor.roles.includes("owner") || actor.roles.includes("admin");
  const abilities: Array<[boolean, string, string]> = [
    [can(actor.roles, "create", "policy"), "create/edit policies", "إنشاء وتحرير السياسات"],
    [can(actor.roles, "publish", "policy"), "publish policies", "نشر السياسات"],
    [can(actor.roles, "create", "risk"), "record and edit risks", "تسجيل المخاطر وتحريرها"],
    [can(actor.roles, "create", "evidence"), "upload documents/evidence", "رفع المستندات والأدلة"],
    [can(actor.roles, "delete", "evidence"), "delete documents", "حذف المستندات"],
    [can(actor.roles, "read", "report"), "view and export reports", "عرض التقارير وتصديرها"],
    [can(actor.roles, "execute", "mission"), "run missions", "تشغيل المهام"],
    [isAdmin, "invite team members and edit organization details", "دعوة أعضاء الفريق وتعديل بيانات المنشأة"],
  ];
  const allowed = abilities.filter(([ok]) => ok).map(([, en, ar]) => (locale === "ar" ? ar : en));
  const denied = abilities.filter(([ok]) => !ok).map(([, en, ar]) => (locale === "ar" ? ar : en));
  return locale === "ar"
    ? `المنشأة: ${actor.organizationName}. المستخدم: ${actor.userName}، الدور: ${roleLabel}.\n` +
        `  - يستطيع: ${allowed.join("، ") || "—"}\n  - لا يستطيع: ${denied.join("، ") || "—"}`
    : `Organization: ${actor.organizationName}. User: ${actor.userName}, role: ${roleLabel}.\n` +
        `  - Can: ${allowed.join(", ") || "—"}\n  - Cannot: ${denied.join(", ") || "—"}`;
}

/** Reports are generated on demand, so what the assistant can honestly say about them is what they
 * would contain right now — the same headline numbers the Executive report opens with. */
function reportsSection(
  coverage: Awaited<ReturnType<typeof computeCoverage>>,
  risks: Risk[],
  policies: Policy[],
  locale: AppLocale,
): string {
  const open = risks.filter((r) => r.status === "open" || r.status === "mitigating").length;
  const published = policies.filter((p) => p.status === "published").length;
  return locale === "ar"
    ? `التقارير: التقرير التنفيذي وتقرير الامتثال وتقرير المخاطر تُنشأ عند الطلب من صفحة التقارير (PDF/Excel). ` +
        `لقطة حالية: تغطية الامتثال ${coverage.overall.coveragePct}%، فجوات الضوابط ${coverage.overall.gaps}، ` +
        `مخاطر مفتوحة ${open}، سياسات معتمدة ${published}.`
    : `Reports: the Executive, Compliance and Risk reports are generated on demand from the Reports page ` +
        `(PDF/Excel). Current snapshot: compliance coverage ${coverage.overall.coveragePct}%, ` +
        `control gaps ${coverage.overall.gaps}, open risks ${open}, published policies ${published}.`;
}

/** Recent missions (Gap/Risk Assessments etc.). The Mission Engine lives in another service, so its
 * being unreachable must never take the assistant down — the section is simply omitted then. */
async function missionsSection(actor: ActorContext, locale: AppLocale): Promise<string | null> {
  try {
    const missions = (await listMissions(actor)).slice(0, 5);
    if (missions.length === 0) return null;
    const lines = missions.map((m) => `  - ${m.type}: ${m.scope} (${m.status})`).join("\n");
    return (locale === "ar" ? "المهام الأخيرة:\n" : "Recent missions:\n") + lines;
  } catch {
    return null;
  }
}

/**
 * Builds the compact, always-included organization context block. Every field is fetched
 * tenant-scoped through `actor` — nothing here can cross into another organization's data.
 */
export async function buildOrganizationContext(actor: ActorContext, locale: AppLocale): Promise<string> {
  const [status, coverage, risks, policies, documents, missions] = await Promise.all([
    getProgramStatus(actor),
    computeCoverage(actor),
    listRisks(actor),
    policyRepository.list(actor.tenantId),
    documentRepository.list(actor.tenantId),
    missionsSection(actor, locale),
  ]);

  const documentsBlock = await documentsSection(documents, locale);

  return [
    identitySection(actor, locale),
    governanceSection(status, locale),
    policiesSection(policies, locale),
    risksSection(risks, locale),
    documentsBlock,
    coverageSection(coverage, locale),
    reportsSection(coverage, risks, policies, locale),
    missions,
  ]
    .filter((section): section is string => section !== null)
    .join("\n\n");
}
