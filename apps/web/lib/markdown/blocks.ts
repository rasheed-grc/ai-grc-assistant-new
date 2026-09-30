/**
 * The small markdown subset model output actually uses — headings, bold, lists, tables — parsed
 * into plain data. Rendering is `components/ui/MarkdownText.tsx`, which builds React elements
 * from this and never HTML, so model text cannot inject markup (CLAUDE.md §19). Anything outside
 * the subset is kept as paragraph text rather than dropped.
 */

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

export type MarkdownInline = { kind: "text" | "strong" | "code"; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function startsBlock(line: string): boolean {
  return HEADING.test(line.trim()) || RULE.test(line) || TABLE_ROW.test(line) || LIST_ITEM.test(line);
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = HEADING.exec(line.trim());
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? "")) {
        if (!TABLE_SEPARATOR.test(lines[i] ?? "")) rows.push(tableCells(lines[i] ?? ""));
        i++;
      }
      const [header = [], ...body] = rows;
      blocks.push({ kind: "table", header, rows: body });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[1] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const next = LIST_ITEM.exec(lines[i] ?? "");
        if (!next || (next[1] !== undefined) !== ordered) break;
        items.push(next[2]!.trim());
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !startsBlock(lines[i] ?? "")) {
      paragraph.push((lines[i] ?? "").trim());
      i++;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

/** `**bold**` and `` `code` ``; everything else stays literal text. */
export function parseMarkdownInline(text: string): MarkdownInline[] {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/)
    .filter((part) => part !== "")
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? { kind: "strong", text: part.slice(2, -2) }
        : part.startsWith("`") && part.endsWith("`") && part.length > 2
          ? { kind: "code", text: part.slice(1, -1) }
          : { kind: "text", text: part },
    );
}
