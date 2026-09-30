import { Fragment } from "react";
import { parseMarkdownBlocks, parseMarkdownInline } from "@/lib/markdown/blocks";
import { cn } from "@/lib/utils";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseMarkdownInline(text).map((part, i) =>
        part.kind === "strong" ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.text}
          </strong>
        ) : part.kind === "code" ? (
          <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">
            {part.text}
          </code>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Model-written text (headings, bold, lists, tables) as readable content instead of raw `#` and
 * `|---|`. Elements only, never HTML — see lib/markdown/blocks.ts. Each block picks its own
 * direction, so an Arabic paragraph and an English control code sit correctly side by side.
 */
export function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-2 text-foreground-secondary", className)}>
      {parseMarkdownBlocks(text).map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <p
                key={i}
                dir="auto"
                className={cn("font-semibold text-foreground", block.level <= 2 && "text-[1.05em]")}
              >
                <Inline text={block.text} />
              </p>
            );
          case "rule":
            return <hr key={i} className="border-hairline" />;
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                dir="auto"
                className={cn("space-y-1 ps-5", block.ordered ? "list-decimal" : "list-disc")}
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-lg border border-hairline">
                <table className="w-full text-start">
                  <thead>
                    <tr className="border-b border-hairline bg-surface/60">
                      {block.header.map((cell, j) => (
                        <th key={j} dir="auto" className="px-2.5 py-1.5 text-start font-medium text-foreground">
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j} className="border-b border-hairline last:border-0">
                        {row.map((cell, k) => (
                          <td key={k} dir="auto" className="px-2.5 py-1.5 align-top">
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={i} dir="auto" className="whitespace-pre-wrap">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
