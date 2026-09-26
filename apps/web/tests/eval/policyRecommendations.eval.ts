/**
 * Regression check for Policies Intelligence (CLAUDE.md §22 — AI components get evaluation
 * tests, not just unit tests). Exercises the real prompt + real model + real Zod schema
 * validation against a realistic, hand-built establishment context (a law firm with AML/data
 * gaps, one existing draft policy, and one real-shaped regulatory excerpt) — no mocking of the
 * generation path itself.
 *
 * Asserts the three things this feature exists to get right:
 * 1. Recommendations are categorized (general/sector/establishment), not a flat list.
 * 2. A recommendation grounded ONLY in the given (unapproved) regulatory excerpt keeps
 *    `isRegulatoryRequirement=false` unless it actually cites that excerpt — the model must not
 *    upgrade a "pending review" source to a settled requirement.
 * 3. At least one recommendation traces back to a specific, real input fact (not generic boilerplate).
 *
 * Requires a live `OPENAI_API_KEY` — skips cleanly otherwise (same convention as
 * arabicAnalysis.eval.ts).
 *
 * Run directly: `pnpm --filter @grc/web exec tsx tests/eval/policyRecommendations.eval.ts`
 * Wired into `pnpm test` via package.json.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const appRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
dotenv.config({ path: path.join(appRoot, ".env.local") });
dotenv.config({ path: path.join(appRoot, "..", "..", ".env") });

const ESTABLISHMENT_NARRATIVE = `المكتب يعمل حالياً بلا أي بنية حوكمة فعلية: لا سياسات، لا سجل مخاطر، لا هيكل صلاحيات موثق.
- [organization/critical] Designate Compliance Owner: لا يوجد لدى المنشأة حالياً مسؤول التزام معيّن، رغم أن المكتب يتعامل مع بيانات شخصية حساسة ويخدم جهات حكومية.
- [risk/high] Establish Risk Register: لا يوجد سجل مخاطر معتمد رغم تعدد مصادر الخطر الفعلية، مثل عدم تطبيق متطلبات مكافحة غسل الأموال رغم إدارة أموال وأصول العملاء.`;

const TOP_RISKS_TEXT =
  "- لا توجد سياسة معتمدة تحدد كيفية جمع البيانات الشخصية ومعالجتها (severity: high)";

const EXISTING_POLICIES_TEXT = '- "ORG-A-ONLY Test Policy" (status: draft)';

// Deliberately marked "قيد المراجعة — لم تُعتمد بعد" (pending review), like a real hit from
// lib/regulatoryReasoning/search would carry for the vast majority of the corpus today — the
// model must not treat this as a settled, citable legal requirement.
const REGULATORY_CONTEXT_TEXT =
  '[R1] "نظام مكافحة جرائم الإرهاب وتمويله" (نظام) — حالة الاعتماد: قيد المراجعة — لم تُعتمد بعد\n' +
  "إجراء تقييم لمخاطر تمويل الإرهاب يأخذ في الحسبان مخاطر العملاء والمستفيد الحقيقي.";

async function main(): Promise<void> {
  const hasKey = Boolean(process.env.OPENAI_API_KEY) && process.env.AI_PROVIDER !== "local";
  if (!hasKey) {
    console.log(
      "SKIP policyRecommendations.eval — no OPENAI_API_KEY configured (set AI_PROVIDER=openai " +
        "and OPENAI_API_KEY to run this check against a live model).",
    );
    return;
  }

  const { buildPolicyRecommendationsPrompt } = await import(
    "../../lib/policyRecommendations/prompts"
  );
  const { llmRecommendationsResponseSchema } = await import(
    "../../lib/policyRecommendations/types"
  );
  const { getChatProvider } = await import("../../lib/ai");

  const chat = getChatProvider();
  const messages = buildPolicyRecommendationsPrompt({
    establishmentNarrative: ESTABLISHMENT_NARRATIVE,
    topRisksText: TOP_RISKS_TEXT,
    registerRisksText: "",
    existingPoliciesText: EXISTING_POLICIES_TEXT,
    regulatoryContextText: REGULATORY_CONTEXT_TEXT,
    locale: "ar",
  });

  console.log(`Requesting policy recommendations from ${chat.id} ...`);
  const raw = await chat.complete(messages, { json: true, maxTokens: 20_000 });

  const parsed = JSON.parse(raw); // fails loudly (uncaught) if the model didn't return JSON
  const result = llmRecommendationsResponseSchema.safeParse(parsed);
  assert(result.success, "response did not match the recommendations schema");
  if (!result.success) return; // unreachable — narrows for TypeScript

  const { recommendations } = result.data;
  assert(recommendations.length >= 3, `expected at least 3 recommendations, got ${recommendations.length}`);

  const categories = new Set(recommendations.map((r) => r.category));
  assert(
    categories.size >= 2,
    `expected recommendations spanning at least 2 categories, got only: ${[...categories].join(", ")}`,
  );

  // The regulatory excerpt given is explicitly unapproved. Any recommendation that cites [R1]
  // must not claim it as a settled regulatory requirement.
  const citingR1 = recommendations.filter((r) => r.references.some((ref) => ref.includes("R1")));
  const wronglyElevated = citingR1.filter((r) => r.isRegulatoryRequirement);
  assert(
    wronglyElevated.length === 0,
    `${wronglyElevated.length} recommendation(s) cited the unapproved [R1] excerpt while marked ` +
      `isRegulatoryRequirement=true: ${wronglyElevated.map((r) => r.title).join(", ")}`,
  );

  // At least one recommendation must trace to a specific, real input fact — not generic
  // boilerplate detached from what was actually given.
  const groundedInInput = recommendations.some(
    (r) =>
      r.basis.includes("Compliance Owner") ||
      r.basis.includes("Risk Register") ||
      r.reason.includes("غسل الأموال") ||
      r.reason.includes("بيانات شخصية"),
  );
  assert(groundedInInput, "no recommendation's basis/reason traced back to a specific given fact");

  console.log("PASS policyRecommendations.eval — grounded, categorized recommendations confirmed:");
  console.log(`  count: ${recommendations.length}, categories: ${[...categories].join(", ")}`);
  const sample = recommendations[0];
  if (sample) {
    console.log(
      `  sample: "${sample.title}" (${sample.category}, ` +
        `${sample.isRegulatoryRequirement ? "regulatory requirement" : "recommended practice"})`,
    );
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`FAIL policyRecommendations.eval — ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error("policyRecommendations.eval crashed:", error);
  process.exitCode = 1;
});
