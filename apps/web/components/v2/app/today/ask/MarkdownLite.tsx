import * as React from "react";

/**
 * An answer's light formatting, drawn as React elements (never as markup: the words can quote a customer's e-mail): paragraphs, "- " and "1. " lists, **bold** and `code`. Anything else is plain text, line breaks kept.
 * It is the same text that is copied, so what the person copies is the words, not the marks.
 */
type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

export function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
    const number = /^\s*\d{1,2}[.)]\s+(.*)$/.exec(raw);
    const last = out[out.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else out.push({ kind: "ul", items: [bullet[1]] });
    } else if (number) {
      if (last?.kind === "ol") last.items.push(number[1]);
      else out.push({ kind: "ol", items: [number[1]] });
    } else if (raw.trim() === "") {
      if (last?.kind === "p" && last.lines.length > 0) out.push({ kind: "p", lines: [] }); // a blank line starts the next paragraph
    } else if (last?.kind === "p") last.lines.push(raw);
    else out.push({ kind: "p", lines: [raw] });
  }
  return out.filter((b) => (b.kind === "p" ? b.lines.length > 0 : b.items.length > 0));
}

/** **bold** and `code` inside one line. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i} className="rounded bg-surface-2 px-1 text-[0.95em]">{part.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export function MarkdownLite({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div data-md="" className={`space-y-2 text-base [overflow-wrap:anywhere] ${className}`}>
      {blocksOf(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <React.Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(l)}
              </React.Fragment>
            ))}
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
