/**
 * Mission output is model-written markdown; lib/markdown/blocks.ts turns the subset it uses into
 * data the UI renders as elements. Pure — no DB, no model.
 */
import { parseMarkdownBlocks, parseMarkdownInline } from "../../lib/markdown/blocks";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const sample = [
  "# تقييم فجوات الأدلة",
  "",
  "بناءً على عمليات البحث، لم يُعثر على أدلة.",
  "سطر ثانٍ من الفقرة نفسها.",
  "",
  "| # | الضابط | الحالة |",
  "|---|--------|--------|",
  "| 1 | A.5.15 | ⚠️ **GAP** |",
  "| 2 | A.8.5 | ⚠️ **GAP** |",
  "",
  "---",
  "1. **التحقق** من الاستعلام",
  "2. تحميل قاعدة الضوابط",
  "- عنصر",
  "- عنصر آخر",
].join("\n");

const blocks = parseMarkdownBlocks(sample);
assert(blocks.map((b) => b.kind).join(",") === "heading,paragraph,table,rule,list,list", `block kinds: ${blocks.map((b) => b.kind)}`);

const heading = blocks[0];
assert(heading?.kind === "heading" && heading.level === 1 && heading.text === "تقييم فجوات الأدلة", "heading text without #");

const paragraph = blocks[1];
assert(paragraph?.kind === "paragraph" && paragraph.text.split("\n").length === 2, "adjacent lines stay one paragraph");

const table = blocks[2];
assert(table?.kind === "table", "table parsed");
if (table?.kind === "table") {
  assert(table.header.join("|") === "#|الضابط|الحالة", `header: ${table.header}`);
  assert(table.rows.length === 2, "separator row dropped, two body rows kept");
  assert(table.rows[0]?.[1] === "A.5.15", "cells trimmed");
}

const ordered = blocks[4];
const unordered = blocks[5];
assert(ordered?.kind === "list" && ordered.ordered && ordered.items.length === 2, "ordered list");
assert(unordered?.kind === "list" && !unordered.ordered && unordered.items.length === 2, "bullets start a new list");

const inline = parseMarkdownInline("⚠️ **GAP** – `A.5.15` لا دليل");
assert(inline.map((p) => p.kind).join(",") === "text,strong,text,code,text", `inline: ${JSON.stringify(inline)}`);
assert(inline[1]?.text === "GAP" && inline[3]?.text === "A.5.15", "markers stripped");

// Plain prose — the governance prompts' contract — passes through untouched.
const prose = parseMarkdownBlocks("نص عادي بلا تنسيق.");
assert(prose.length === 1 && prose[0]?.kind === "paragraph" && prose[0].text === "نص عادي بلا تنسيق.", "plain text unchanged");

// Markup is data, never HTML: angle brackets survive as literal text.
const injected = parseMarkdownInline("<img src=x onerror=alert(1)>");
assert(injected.length === 1 && injected[0]?.kind === "text", "HTML stays text");

console.log("PASS markdownText.eval");
