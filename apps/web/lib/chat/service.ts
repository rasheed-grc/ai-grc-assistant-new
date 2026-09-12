/**
 * Chat/RAG service. Retrieves grounding from the tenant's indexed documents (the P4 vector
 * store), assembles numbered citations, and builds the prompt the streaming route generates
 * from. Enforces read permission on `knowledge_source` and keeps everything tenant-scoped.
 * Node-only.
 */

import { randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import type { ActorContext } from "@/lib/auth/actor";
import { getEmbeddingProvider, type ChatMessage } from "@/lib/ai";
import { vectorStore } from "@/lib/analysis/vector-store";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import type { AppLocale } from "@/i18n/routing";
import { conversationRepository } from "./repository";
import { buildOrganizationContext } from "./orgContext";
import {
  searchRegulatorySources,
  DOCUMENT_TYPE_LABEL_AR,
  DOCUMENT_TYPE_LABEL_EN,
  STATUS_LABEL_AR,
  STATUS_LABEL_EN,
  type RegulatorySourceHit,
} from "@/lib/regulatoryReasoning/search";
import type { ChatMessageRecord, Citation, Conversation } from "./types";

const TOP_K = 6;
// Must be >= `chunkText`'s `maxChars` default (1200, `lib/analysis/chunk.ts`) — a chunk is already
// the retrieval unit, bounded to that size at index time. Truncating it further here silently
// drops up to the last ~40% of a chunk's genuinely-retrieved, on-topic content before the model
// ever sees it, which reads to the model as "not in the indexed content" for a fact that actually
// is — verified live: a fact placed near the end of a 1020-char chunk was invisible to the model
// at the old 700-char cut, and the model (correctly, per its grounding instructions) reported it
// as missing rather than guessing. Matching this to the real chunk size closes that gap; 6 chunks
// at up to 1200 chars is still a small, bounded prompt addition (~1800 tokens worst case).
const SNIPPET_CHARS = 1200;
const HISTORY_WINDOW = 8;

function ensureCanChat(actor: ActorContext): void {
  if (!can(actor.roles, "read", "knowledge_source")) {
    throw new ForbiddenError("You are not permitted to use the AI assistant.");
  }
}

export async function listConversations(actor: ActorContext): Promise<Conversation[]> {
  ensureCanChat(actor);
  return conversationRepository.list(actor.tenantId, actor.userId);
}

export async function getConversation(actor: ActorContext, id: string): Promise<Conversation> {
  ensureCanChat(actor);
  const conversation = await conversationRepository.get(actor.tenantId, actor.userId, id);
  if (!conversation) throw new NotFoundError("Conversation not found.");
  return conversation;
}

export async function deleteConversation(actor: ActorContext, id: string): Promise<void> {
  ensureCanChat(actor);
  await conversationRepository.delete(actor.tenantId, actor.userId, id);
}

export interface PreparedTurn {
  conversation: Conversation;
  citations: Citation[];
  llmMessages: ChatMessage[];
}

/** Load/create the conversation, append the user turn, and retrieve grounding. */
export async function prepareTurn(
  actor: ActorContext,
  conversationId: string | null,
  userText: string,
): Promise<PreparedTurn> {
  ensureCanChat(actor);
  const now = new Date().toISOString();

  let conversation: Conversation;
  if (conversationId) {
    const existing = await conversationRepository.get(actor.tenantId, actor.userId, conversationId);
    if (!existing) throw new NotFoundError("Conversation not found.");
    conversation = existing;
  } else {
    conversation = {
      id: randomUUID(),
      tenantId: actor.tenantId,
      userId: actor.userId,
      title: deriveTitle(userText),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await conversationRepository.create(conversation);
  }

  const userMessage: ChatMessageRecord = {
    id: randomUUID(),
    role: "user",
    content: userText,
    createdAt: now,
  };
  await conversationRepository.appendMessage(
    actor.tenantId,
    actor.userId,
    conversation.id,
    userMessage,
  );

  const locale = await getRequestLocale();
  const [citations, organizationContext, regulatoryHits] = await Promise.all([
    retrieve(actor, userText),
    buildOrganizationContext(actor, locale),
    searchRegulatorySources(userText),
  ]);
  const llmMessages = buildMessages(
    conversation.messages,
    citations,
    userText,
    locale,
    organizationContext,
    regulatoryHits,
  );

  return {
    conversation: { ...conversation, messages: [...conversation.messages, userMessage] },
    citations,
    llmMessages,
  };
}

export async function finalizeTurn(
  actor: ActorContext,
  conversationId: string,
  assistantText: string,
  citations: Citation[],
): Promise<ChatMessageRecord> {
  const message: ChatMessageRecord = {
    id: randomUUID(),
    role: "assistant",
    content: assistantText,
    citations,
    createdAt: new Date().toISOString(),
  };
  await conversationRepository.appendMessage(actor.tenantId, actor.userId, conversationId, message);
  return message;
}

async function retrieve(actor: ActorContext, query: string): Promise<Citation[]> {
  const [queryVector] = await getEmbeddingProvider().embed([query]);
  if (!queryVector) return [];
  const hits = await vectorStore.search(actor.tenantId, queryVector, TOP_K);
  return hits
    .filter((hit) => hit.score > 0.05)
    .map((hit, i) => ({
      index: i + 1,
      documentId: hit.documentId,
      fileName: hit.fileName,
      chunkIndex: hit.chunk.index,
      snippet: hit.chunk.text.slice(0, SNIPPET_CHARS),
      score: Number(hit.score.toFixed(4)),
    }));
}

/** Formats regulatory search hits into a labeled context block — every hit states its source
 *  type (نظام/لائحة تنفيذية/...) and review status (معتمدة/قيد المراجعة/...) explicitly, since the
 *  model must never present unapproved or superseded text as a settled requirement. Markers use
 *  an "R" prefix (R1, R2, ...) so they can never collide with the document-excerpt [1], [2]
 *  markers — the two are different kinds of source and must stay visibly distinguishable. */
function formatRegulatoryContext(hits: RegulatorySourceHit[], locale: AppLocale): string {
  if (hits.length === 0) {
    return locale === "ar"
      ? "لم يُعثر على مادة نظامية ذات صلة في القاعدة النظامية المتاحة لهذا السؤال."
      : "No relevant material was found in the available regulatory corpus for this question.";
  }
  const typeLabels = locale === "ar" ? DOCUMENT_TYPE_LABEL_AR : DOCUMENT_TYPE_LABEL_EN;
  const statusLabels = locale === "ar" ? STATUS_LABEL_AR : STATUS_LABEL_EN;
  return hits
    .map((hit, i) => {
      const heading =
        locale === "ar"
          ? `[R${i + 1}] "${hit.sourceTitleAr}" (${typeLabels[hit.documentType]}) — ` +
            `الجهة المُصدرة: ${hit.authority} — حالة الاعتماد: ${statusLabels[hit.status]}` +
            (hit.sectionTitleAr ? ` — ${hit.sectionCode}: ${hit.sectionTitleAr}` : ` — ${hit.sectionCode}`)
          : `[R${i + 1}] "${hit.sourceTitleAr}" (${typeLabels[hit.documentType]}) — ` +
            `issuing authority: ${hit.authority} — approval status: ${statusLabels[hit.status]}` +
            (hit.sectionTitleAr ? ` — ${hit.sectionCode}: ${hit.sectionTitleAr}` : ` — ${hit.sectionCode}`);
      return `${heading}\n${hit.textAr}\n(${hit.boeSourceUrl})`;
    })
    .join("\n\n");
}

function buildMessages(
  history: ChatMessageRecord[],
  citations: Citation[],
  userText: string,
  locale: AppLocale,
  organizationContext: string,
  regulatoryHits: RegulatorySourceHit[],
): ChatMessage[] {
  const context =
    citations.length > 0
      ? citations.map((c) => `[${c.index}] (${c.fileName}): ${c.snippet}`).join("\n\n")
      : "No relevant excerpts were found in the knowledge base.";
  const regulatoryContext = formatRegulatoryContext(regulatoryHits, locale);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are the Rasheed assistant — a senior Governance, Risk & Compliance advisor for THIS " +
        "specific organization, not a general-purpose chatbot. You are given two kinds of grounding: " +
        "(1) 'Organization context' — live facts about this organization's governance program, " +
        "policies, risks, framework coverage, and its DOCUMENT LIST (filenames, categories, " +
        "processing status, upload dates); treat it as ground truth about the organization's current " +
        "state, but it is not a cited source — never attach a [n] marker to it. The document list is " +
        "METADATA ONLY: knowing a document exists or its processing status is not the same as " +
        "knowing what it says — never infer or guess a document's content from its filename, " +
        "category, or status. (2) Numbered document excerpts — the actual indexed CONTENT of " +
        "whichever documents were relevant to this question; cite every claim drawn from them " +
        "inline with its marker, e.g. [1] or [2]. If the user asks about a document that appears in " +
        "the document list but has no excerpt among the numbered ones, say so plainly — either it " +
        "isn't processed yet (check its status in the document list) or nothing in it was relevant " +
        "to this question — never invent what it might contain. Prefer the organization context to " +
        "tailor your answer to this organization specifically (its actual open tasks, policies, risk " +
        "count, coverage, documents on file) rather than answering generically; when a section of the " +
        "organization context says nothing is recorded yet, say so plainly instead of guessing. " +
        "(3) 'Regulatory sources' — real excerpts from the national regulatory corpus (laws, " +
        "executive regulations, government guides, standards, etc.), each already labeled with its " +
        "source TYPE and its APPROVAL STATUS; cite these with an R-marker, e.g. [R1] or [R2], never " +
        "reusing the plain [n] markers reserved for document excerpts. When a legal/regulatory " +
        "question comes up: identify the topic and the organization's sector/situation from the " +
        "organization context, then consider ALL matching regulatory sources rather than assuming " +
        "any single one governs the topic; explicitly name each source's type (e.g. this is a " +
        "نظام/law vs. a لائحة تنفيذية/executive regulation) so the reader knows what kind of " +
        "instrument they're reading, not just its title. NEVER present something as a regulatory " +
        "requirement unless an [Rn] excerpt actually states it — a source whose status is anything " +
        "other than approved/published (e.g. pending review, superseded, archived) MUST be flagged " +
        "as such in the same sentence that cites it (e.g. 'per a not-yet-approved excerpt of...') " +
        "— never present unreviewed or superseded text with the same confidence as approved text. A " +
        "control/practice with NO supporting [Rn] excerpt (e.g. a password-policy detail you'd " +
        "normally recommend) must be labeled explicitly as a recommended practice, not a legal " +
        "requirement. If the regulatory sources found are insufficient, silent on the exact " +
        "question, or contradict each other, say so explicitly rather than picking one and moving " +
        "on. If no regulatory source was found at all, say so plainly — do not fall back to general " +
        "knowledge of the law and present it as if it were sourced. If neither the document " +
        "excerpts nor the regulatory sources answer the question, say plainly that you don't have " +
        "enough information and state what's missing " +
        "— never fabricate facts, control IDs, statistics, or citations, and never speculate on " +
        "compliance matters. Structure substantive answers for an executive reader: lead with a " +
        "direct, one-sentence answer, then supporting detail as short paragraphs or bullet points. " +
        "For a simple greeting or clarifying question, respond briefly and conversationally instead " +
        "— do not force structure where it doesn't fit. Avoid generic AI filler phrasing (e.g. " +
        '"it is important to note", "as an AI"). ' +
        languageInstruction(locale),
    },
    { role: "system", content: `Organization context:\n\n${organizationContext}` },
    { role: "system", content: `Document excerpts:\n\n${context}` },
    { role: "system", content: `Regulatory sources:\n\n${regulatoryContext}` },
  ];

  for (const message of history.slice(-HISTORY_WINDOW)) {
    messages.push({ role: message.role, content: message.content });
  }
  messages.push({ role: "user", content: userText });
  return messages;
}

function languageInstruction(locale: AppLocale): string {
  if (locale === "ar") {
    return (
      "Respond entirely in professional, formal Modern Standard Arabic (فصحى), in the tone of " +
      "a senior GRC advisor — except for internationally recognized framework names/codes " +
      "(e.g. ISO 27001, NIST CSF, PDPL, NCA ECC, SAMA, COBIT, COSO, CIS), which stay in English " +
      "exactly as written."
    );
  }
  return "Respond in professional, formal business English.";
}

function deriveTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "New conversation";
}
