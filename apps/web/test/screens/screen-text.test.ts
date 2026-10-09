import { describe, expect, it } from "vitest";

import { screenText } from "./screen-text";

const text = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.append(div);
  const out = screenText(div);
  div.remove();
  return out;
};

describe("screenText", () => {
  it("keeps words, headings, links, buttons and controls, and ignores classes and wrappers", () => {
    const a = text('<main class="shell"><h1>Orders</h1><p class="hint">Hello <strong>there</strong>.</p><a href="/x" class="tap">Open</a><form><label for="q">Name</label><input id="q" name="q" required><button type="submit" class="secondary">Go</button></form></main>');
    const b = text('<section class="v2"><h1 class="text-3xl">Orders</h1><div>Hello <b>there</b>.</div><a href="/x" class="btn">Open</a><form><label for="q" class="l">Name</label><input id="q" name="q" required class="i"><button type="submit">Go</button></form></section>');
    expect(a).toBe(b);
    expect(a).toContain("# Orders");
    expect(a).toContain("[Open](/x)");
    expect(a).toContain('<text name=q label="Name" required>');
    expect(a).toContain("[button type=submit: Go]");
  });

  it("notices a changed word, a changed link target, a lost field and a changed heading level", () => {
    const base = '<h2>Money</h2><a href="/a">Pay</a><input name="n" required>';
    expect(text(base.replace("Money", "Cash"))).not.toBe(text(base));
    expect(text(base.replace("/a", "/b"))).not.toBe(text(base));
    expect(text(base.replace(" required", ""))).not.toBe(text(base));
    expect(text(base.replace("h2", "h3").replace("/h2", "/h3"))).not.toBe(text(base));
  });

  it("writes roles and labels, select options, hidden values and table rows", () => {
    const out = text(
      '<p role="note">Careful</p><select name="s"><option value="a" selected>One</option><option value="b">Two</option></select><input type="hidden" name="id" value="9"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(out).toContain("{role=note} Careful");
    expect(out).toContain("options: One=a* | Two=b");
    expect(out).toContain("<hidden name=id value=9>");
    expect(out).toContain("| th A | th B |");
    expect(out).toContain("| 1 | 2 |");
  });
});
