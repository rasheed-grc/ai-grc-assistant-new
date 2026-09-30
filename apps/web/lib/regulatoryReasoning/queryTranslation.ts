/**
 * The regulatory corpus is Arabic text, and retrieval matches Arabic keywords — so an English
 * question ("does Saudi law impose anti-money-laundering obligations on a law firm?") used to find
 * nothing and the Assistant answered "no AML sources on file" while the AML law was sitting in the
 * library. This turns a non-Arabic question into Arabic search terms.
 *
 * Two layers, cheapest first, both producing SEARCH TERMS only — never an answer, never a source:
 *  1. a small bilingual glossary of GRC/legal terms (deterministic, instant, no model call);
 *  2. when the glossary recognises nothing, one short model call that translates the question's
 *     subject into Arabic legal terms. A failure here degrades to "no extra terms" — retrieval then
 *     honestly finds nothing, exactly as before — it never throws into the answer path.
 */

import { getChatProvider } from "@/lib/ai";
import { logger } from "@/lib/observability/logger";

const ARABIC_LETTER = /[؀-ۿ]/g;
const LATIN_LETTER = /[A-Za-z]/g;
const HAS_ARABIC = /[\u0600-\u06FF]/;

/** True when the text is mostly Latin script — i.e. keywords extracted from it cannot match the
 * Arabic corpus and need translating. */
export function needsArabicTranslation(text: string): boolean {
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0;
  return latin > 0 && latin > arabic;
}

/** English phrase (lowercase, matched as a substring) → Arabic terms as they appear in Saudi
 * regulation text. Terms, not sources: nothing here says what any law requires. */
const GLOSSARY: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/money[\s-]?laundering|\baml\b/i, ["غسل الأموال", "غسل"]],
  [/terror(ism)?[\s-]?financ|\bcft\b|counter[\s-]?terror/i, ["تمويل الإرهاب", "الإرهاب"]],
  [/personal data|data protection|\bpdpl\b|privacy|data breach|data leak/i, ["البيانات الشخصية", "حماية البيانات", "تسرب"]],
  [/cyber ?crime|cyber ?security|information security|electronic|e-?commerce/i, ["الجرائم المعلوماتية", "الأمن السيبراني", "المعاملات الإلكترونية"]],
  [/anti[\s-]?fraud|fraud|bribery|corruption|graft/i, ["الرشوة", "الفساد", "الاحتيال"]],
  [/law firm|lawyer|legal profession|advocate|attorney/i, ["المحاماة", "المحامي", "المحاماه"]],
  [/conflict of interest/i, ["تعارض المصالح", "تضارب المصالح"]],
  [/confidential|secrecy|professional secret/i, ["السرية", "سر المهنة"]],
  [/employ(er|ee|ment)|labou?r|worker|end[\s-]of[\s-]service/i, ["العمل", "العامل", "صاحب العمل"]],
  [/company|companies|commercial|shareholder|partnership/i, ["الشركات", "التجاري", "الشركة"]],
  [/contract|obligation|liabilit/i, ["العقد", "الالتزام", "المسؤولية"]],
  [/health|hospital|patient|medical/i, ["الصحة", "المريض", "الصحية"]],
  [/tax|zakat|vat|customs/i, ["الضريبة", "الزكاة", "الجمارك"]],
  [/procurement|tender|government (contract|purchase)/i, ["المنافسات", "المشتريات الحكومية"]],
  [/intellectual property|copyright|trademark|patent/i, ["الملكية الفكرية", "حقوق المؤلف", "العلامات التجارية"]],
  [/penalt|fine|sanction|imprisonment/i, ["العقوبة", "الغرامة", "السجن"]],
  [/court|litigation|procedure|criminal|prosecut/i, ["المحكمة", "الإجراءات", "النيابة العامة"]],
  [/real estate|property|lease|rent/i, ["العقار", "الإيجار", "التسجيل العيني"]],
  [/record|retention|document(s)? keeping|archive/i, ["السجلات", "حفظ", "الوثائق"]],
];

export function glossaryTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const [pattern, arabic] of GLOSSARY) {
    if (pattern.test(text)) for (const term of arabic) terms.add(term);
  }
  return [...terms];
}

const cache = new Map<string, string[]>();

async function translateWithModel(text: string): Promise<string[]> {
  const cached = cache.get(text);
  if (cached) return cached;
  try {
    const raw = await getChatProvider().complete(
      [
        {
          role: "system",
          content:
            "You convert a compliance question into Arabic SEARCH KEYWORDS for a corpus of Saudi " +
            "laws and regulations. Output ONLY JSON: {\"terms\": string[]} with 2 to 6 short Arabic " +
            "legal terms (single words or two-word phrases) exactly as they would appear in the law " +
            "text. Do not answer the question and do not cite any law.",
        },
        { role: "user", content: text.slice(0, 500) },
      ],
      { json: true, maxTokens: 3000 },
    );
    const parsed = JSON.parse(raw) as { terms?: unknown };
    const terms = Array.isArray(parsed.terms)
      ? parsed.terms
          .filter((t): t is string => typeof t === "string" && HAS_ARABIC.test(t))
          .map((t) => t.trim())
          .slice(0, 6)
      : [];
    cache.set(text, terms);
    return terms;
  } catch (error) {
    logger.error("regulatory_query_translation_failed", error);
    return [];
  }
}

/** Arabic search terms for a non-Arabic question; `[]` when the question is already Arabic, or
 * nothing could be derived. */
export async function arabicSearchTerms(text: string): Promise<string[]> {
  if (!needsArabicTranslation(text)) return [];
  const fromGlossary = glossaryTerms(text);
  if (fromGlossary.length > 0) return fromGlossary;
  return translateWithModel(text);
}
