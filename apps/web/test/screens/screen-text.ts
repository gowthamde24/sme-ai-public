/**
 * The plain-text snapshot of a rendered screen (workspace redesign, Batch 0).
 *
 * What it keeps: the visible words and numbers in order, headings (with their level), link targets, button names, form
 * controls (kind, name, label, required, disabled, hidden values), options, table rows, roles and aria labels.
 * What it ignores on purpose: class names, ids, inline styles, data attributes, and which element type wraps a run of words
 * (a <p> turned into a <div>, or a <span> into a <p>, changes nothing). A restyle may therefore change markup freely and must
 * not change this text. A line break is written only at headings, list items, table rows, form controls, buttons, fieldsets,
 * details and sections that carry a role or a label; plain paragraphs run on.
 *
 * Pure DOM in, text out: no React, no network.
 */

const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG", "svg", "PATH", "path"]);
const FLUSH = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "FORM", "FIELDSET", "LEGEND", "SUMMARY", "DETAILS", "TABLE", "CAPTION", "UL", "OL", "DL", "HR", "ARTICLE", "DT"]);

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function labelOf(el: Element, root: ParentNode): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return squash(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const parts = by.split(/\s+/).map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent ?? "");
    const joined = squash(parts.join(" "));
    if (joined) return joined;
  }
  const id = el.getAttribute("id");
  if (id) {
    const l = root.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l) return squash(l.textContent ?? "");
  }
  const wrap = el.closest("label");
  if (wrap) return squash(wrap.textContent ?? "");
  return "";
}

function control(el: Element, root: ParentNode): string {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];
  const type = el.getAttribute("type");
  if (tag === "input") attrs.push(type ?? "text");
  else attrs.push(tag);
  const name = el.getAttribute("name");
  if (name) attrs.push(`name=${name}`);
  const label = labelOf(el, root);
  if (label) attrs.push(`label="${label}"`);
  if (el.hasAttribute("required")) attrs.push("required");
  if (el.hasAttribute("disabled")) attrs.push("disabled");
  if (el.hasAttribute("readonly")) attrs.push("readonly");
  const ph = el.getAttribute("placeholder");
  if (ph) attrs.push(`placeholder="${ph}"`);
  for (const a of ["min", "max", "maxlength", "minlength", "pattern", "inputmode", "autocomplete", "accept", "step"]) {
    const v = el.getAttribute(a);
    if (v !== null) attrs.push(`${a}=${v}`);
  }
  if (tag === "input" && (type === "hidden" || type === "checkbox" || type === "radio")) {
    const v = el.getAttribute("value");
    if (v !== null) attrs.push(`value=${v}`);
    if ((el as HTMLInputElement).checked) attrs.push("checked");
  } else if (tag === "input") {
    const v = el.getAttribute("value");
    if (v) attrs.push(`value=${v}`);
  }
  if (tag === "textarea") {
    const v = el.textContent ?? "";
    if (v) attrs.push(`value="${squash(v)}"`);
  }
  if (el.hasAttribute("aria-invalid")) attrs.push(`aria-invalid=${el.getAttribute("aria-invalid")}`);
  const desc = el.getAttribute("aria-describedby");
  if (desc) {
    const t = squash(
      desc
        .split(/\s+/)
        .map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent ?? "")
        .join(" "),
    );
    if (t) attrs.push(`described-by="${t}"`);
  }
  return `<${attrs.join(" ")}>`;
}

/** The text snapshot of everything under `container`. */
export function screenText(container: Element): string {
  const root = container.ownerDocument ?? (container as unknown as ParentNode);
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    const t = squash(cur);
    if (t) lines.push(t);
    cur = "";
  };
  const put = (s: string) => {
    cur += (cur && !cur.endsWith(" ") && !s.startsWith(" ") ? " " : "") + s;
  };

  const walk = (node: Node, depth: number) => {
    if (node.nodeType === 3) {
      const t = squash(node.textContent ?? "");
      if (t) put(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName;
    if (SKIP.has(tag) || SKIP.has(tag.toLowerCase())) return;
    if (el.hasAttribute("hidden") && !/^(1|true)$/.test(el.getAttribute("data-snapshot-keep") ?? "")) {
      // hidden content is not on the screen; but note it so a restyle cannot drop it silently
      flush();
      lines.push(`[hidden element <${tag.toLowerCase()}>]`);
      return;
    }
    const role = el.getAttribute("role");
    const aria = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" ? null : (el.getAttribute("aria-label") ?? (el.hasAttribute("aria-labelledby") ? labelOf(el, root) : null));

    if (tag === "INPUT" || tag === "TEXTAREA") {
      flush();
      lines.push(control(el, root));
      return;
    }
    if (tag === "SELECT") {
      flush();
      lines.push(control(el, root));
      const options = [...el.querySelectorAll("option")].map((o) => {
        const v = o.getAttribute("value");
        return `${squash(o.textContent ?? "")}${v !== null && v !== squash(o.textContent ?? "") ? `=${v}` : ""}${(o as HTMLOptionElement).selected ? "*" : ""}`;
      });
      lines.push(`  options: ${options.join(" | ")}`);
      return;
    }
    if (tag === "BUTTON") {
      flush();
      const name = squash(el.getAttribute("aria-label") ?? el.textContent ?? "");
      const type = el.getAttribute("type");
      lines.push(`[button${type ? ` type=${type}` : ""}${el.hasAttribute("disabled") ? " disabled" : ""}${el.getAttribute("name") ? ` name=${el.getAttribute("name")}` : ""}${el.getAttribute("value") ? ` value=${el.getAttribute("value")}` : ""}: ${name}]`);
      return;
    }
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      const inner = new SnapshotInline(el);
      const text = inner.text();
      const cur2 = el.getAttribute("aria-current");
      put(`[${text}](${href}${cur2 ? ` current=${cur2}` : ""}${el.getAttribute("aria-label") && el.getAttribute("aria-label") !== text ? ` label="${el.getAttribute("aria-label")}"` : ""})`);
      return;
    }
    if (tag === "IMG") {
      put(`[image: ${el.getAttribute("alt") ?? ""}]`);
      return;
    }
    if (tag === "BR") {
      put(" ");
      return;
    }

    const isCell = tag === "TD" || tag === "TH";
    const block = FLUSH.has(tag) || (role !== null && role !== "presentation" && role !== "none") || aria !== null;
    if (block) {
      flush();
      const label = [];
      if (role) label.push(`role=${role}`);
      if (aria) label.push(`label="${squash(aria)}"`);
      if (tag === "TH" || tag === "TD") {
        /* handled below */
      }
      if (/^H[1-6]$/.test(tag)) cur = `${"#".repeat(Number(tag[1]))} `;
      else if (tag === "LI") cur = "- ";
      else if (label.length) cur = `{${label.join(" ")}} `;
      else if (tag === "LEGEND") cur = "legend: ";
      else if (tag === "SUMMARY") cur = "summary: ";
      else if (tag === "CAPTION") cur = "caption: ";
      else if (tag === "FORM") {
        const lab = labelOf(el, root);
        cur = `form${lab ? ` "${lab}"` : ""}:`;
        flush();
      }
      if (el.hasAttribute("open") && tag === "DETAILS") cur = "details (open):";
      if (tag === "TABLE") {
        flush();
        walkTable(el, depth);
        return;
      }
    }
    if (isCell) put(" | ");
    for (const child of Array.from(el.childNodes)) walk(child, depth + 1);
    if (isCell) put(" ");
    if (block) flush();
  };

  const walkTable = (table: Element, depth: number) => {
    const caption = table.querySelector("caption");
    if (caption) lines.push(`caption: ${squash(caption.textContent ?? "")}`);
    const labelT = table.getAttribute("aria-label");
    lines.push(`table${labelT ? ` "${squash(labelT)}"` : ""}:`);
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const cells: string[] = [];
      for (const cell of Array.from(row.children)) {
        if (cell.tagName !== "TD" && cell.tagName !== "TH") continue;
        const sub: string[] = [];
        const savedLines = lines.length;
        const savedCur = cur;
        cur = "";
        for (const child of Array.from(cell.childNodes)) walk(child, depth + 1);
        flush();
        sub.push(...lines.splice(savedLines));
        cur = savedCur;
        cells.push(`${cell.tagName === "TH" ? "th " : ""}${sub.join(" / ")}`);
      }
      lines.push(`  | ${cells.join(" | ")} |`);
    }
  };

  for (const child of Array.from(container.childNodes)) walk(child, 0);
  flush();
  return lines.join("\n") + "\n";
}

/** The inline text of a link (buttons and controls inside a link are not expected; their text is kept as text). */
class SnapshotInline {
  constructor(private el: Element) {}
  text(): string {
    const parts: string[] = [];
    const go = (n: Node) => {
      if (n.nodeType === 3) parts.push(n.textContent ?? "");
      else if (n.nodeType === 1) {
        const e = n as Element;
        if (SKIP.has(e.tagName) || SKIP.has(e.tagName.toLowerCase())) return;
        if (e.tagName === "IMG") parts.push(e.getAttribute("alt") ?? "");
        else Array.from(e.childNodes).forEach(go);
      }
    };
    Array.from(this.el.childNodes).forEach(go);
    return squash(parts.join(" "));
  }
}
