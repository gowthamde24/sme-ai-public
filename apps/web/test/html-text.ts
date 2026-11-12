/**
 * The visible text of server-rendered HTML, for a test: the page is read with the HTML parser (the DOM's own), its scripts and styles are left out and the pieces of text are joined with a space; entities come out decoded. Tests used to strip
 * markup with regular expressions (one for the script elements, one for any tag), which are not an HTML parser (CodeQL js/bad-tag-filter, js/incomplete-multi-character-sanitization).
 */
export function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((n) => n.remove());
  const parts: string[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
  return parts.join(" ");
}

/** A string as a regular-expression source that matches exactly itself (every character that has a meaning in a pattern is escaped, the backslash included). */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/@-]/g, "\\$&");
