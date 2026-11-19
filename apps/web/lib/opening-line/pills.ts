import { PLACEHOLDERS, type Placeholder } from "./types";

/**
 * The greeting as the owner sees it: plain words in pills ("the customer's name"), never curly braces. What is stored and sent stays what the API takes today ({customer} {assistant} {business} {agent_role}):
 * this ONE pure helper turns the stored text into segments for the box and the box back into the stored text, so the saved payload is exactly the old one. Only the four known placeholders are pills; any other
 * brace text stays text (and the box says to take it out: the API refuses it).
 */
export type Segment = { kind: "text"; text: string } | { kind: "pill"; name: Placeholder };

/** The stored text as segments, in order. Adjacent text is one segment; an empty text is no segments. */
export function toSegments(stored: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const push = (text: string) => {
    if (text === "") return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === "text") prev.text += text;
    else out.push({ kind: "text", text });
  };
  for (const m of stored.matchAll(/\{(\w*)\}/g)) {
    const name = m[1];
    push(stored.slice(last, m.index));
    if ((PLACEHOLDERS as readonly string[]).includes(name)) out.push({ kind: "pill", name: name as Placeholder });
    else push(m[0]);
    last = (m.index ?? 0) + m[0].length;
  }
  push(stored.slice(last));
  return out;
}

/** The segments back as the stored text. */
export const fromSegments = (segments: readonly Segment[]): string => segments.map((s) => (s.kind === "pill" ? `{${s.name}}` : s.text)).join("");

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The box's content as HTML: text, and each pill as a fixed (not editable) chip carrying its name in `data-ph` and its plain words as its text. `words` gives the plain words of a pill. */
export const segmentsToHtml = (segments: readonly Segment[], words: (name: Placeholder) => string): string =>
  segments
    .map((s) => (s.kind === "pill" ? `<span contenteditable="false" data-ph="${s.name}" class="vt-pill mx-0.5 inline-block select-none rounded-full bg-brand-bg px-2.5 py-0.5 align-baseline text-[15px] font-semibold leading-snug text-brand-text">${esc(words(s.name))}</span>` : esc(s.text)))
    .join("");

/** What the box holds, read back from its DOM: text nodes are text, a pill is its placeholder, a line break is a space (the greeting is one paragraph). */
export function readBox(root: Node): string {
  let out = "";
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent ?? "";
    else if (n instanceof HTMLElement) {
      const ph = n.getAttribute("data-ph");
      if (ph && (PLACEHOLDERS as readonly string[]).includes(ph)) out += `{${ph}}`;
      else if (n.tagName === "BR") out += " ";
      else out += readBox(n);
    }
  });
  return out.replace(/ /g, " ").replace(/\s+/g, (m) => (m.includes("\n") ? " " : m));
}
