/**
 * An English regulatory question must reach the Arabic corpus. Runs the real search against the
 * real regulation tables (skips without DATABASE_URL); the glossary path needs no model.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { glossaryTerms, needsArabicTranslation } from "../../lib/regulatoryReasoning/queryTranslation";

const appRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
dotenv.config({ path: path.join(appRoot, ".env.local") });
dotenv.config({ path: path.join(appRoot, "..", "..", ".env") });

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`FAIL: ${m}`);
}

assert(needsArabicTranslation("Does Saudi law impose AML duties?"), "English needs translating");
assert(!needsArabicTranslation("ما التزامات مكتب المحاماة؟"), "Arabic does not");
assert(glossaryTerms("anti-money-laundering obligations for a law firm").includes("غسل الأموال"), "AML glossary");
assert(glossaryTerms("weather forecast").length === 0, "unrelated text maps to nothing");

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP regulatoryQueryTranslation.eval (search part) — DATABASE_URL not set.");
    return;
  }
  const { searchRegulatorySources } = await import("../../lib/regulatoryReasoning/search");
  const { getPool } = await import("../../lib/db/pool");
  const en = await searchRegulatorySources("Does Saudi law impose anti-money-laundering obligations on a law firm?");
  assert(en.length > 0, "English AML question must retrieve sections");
  assert(en.some((h) => h.sourceTitleAr.includes("غسل الأموال")), `AML law must be among hits: ${en.map((h) => h.sourceTitleAr).join(" | ")}`);
  const ar = await searchRegulatorySources("ما التزامات مكتب المحاماة بموجب نظام مكافحة غسل الأموال؟");
  assert(ar.some((h) => h.sourceTitleAr.includes("غسل الأموال")), "Arabic path still works");
  const none = await searchRegulatorySources("What is the Quantum Data Sovereignty Law of 2031 article 999?");
  assert(none.every((h) => !h.sourceTitleAr.includes("Quantum")), "no fabricated source");
  console.log(`regulatoryQueryTranslation.eval: ok (EN hits: ${en.length}, first: ${en[0]?.sourceTitleAr})`);
  await getPool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
