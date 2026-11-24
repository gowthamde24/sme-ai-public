/**
 * "No fill-in-the-blank sentences" (owner, 25 Nov 2026: "I don't like this style, people also will not like it"): a form field has a label ABOVE it and, at most, one grey hint BELOW it. It never sits inside a sentence.
 * The rule for a rendered form: no input, select or textarea has bare words (text directly in its line, not a label or hint element) before it AND after it, and none is followed by a sentence-ending mark; a label that ends with ":" is fine.
 * (A label above and a hint below are elements; a sentence form puts its words as text around the control.)
 * Returns the offending snippets (an empty list = fine). Use `expectNoSentenceForm(container)` in a component test.
 */
const CONTROL = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]),select,textarea";
export function sentenceFormsIn(root: ParentNode): string[] {
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll(CONTROL))) {
    const parent = el.parentElement;
    if (!parent) continue;
    let before = "";
    let after = "";
    let seen = false;
    for (const node of Array.from(parent.childNodes)) {
      if (node === el) {
        seen = true;
        continue;
      }
      if (node.nodeType === 1) continue; // an element (a label, a hint, another control) is not a word of the sentence
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (seen) after += ` ${text}`;
      else before += ` ${text}`;
    }
    before = before.trim();
    after = after.trim();
    if (before && after && !/:$/.test(before) && !/^[([]/.test(after)) found.push(`${before} [${el.tagName.toLowerCase()}] ${after}`.slice(0, 140));
    else if (!before && /^[.,;!?]/.test(after)) found.push(`[${el.tagName.toLowerCase()}] ${after}`.slice(0, 100));
  }
  return found;
}
export function expectNoSentenceForm(root: ParentNode): void {
  const found = sentenceFormsIn(root);
  if (found.length > 0) throw new Error(`a control sits inside a sentence (fill-in-the-blank): ${found.join(" | ")}`);
}
