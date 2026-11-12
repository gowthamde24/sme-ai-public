import { describe, expect, it } from "vitest";

import { escapeRegExp, htmlText } from "./html-text";

describe("htmlText: the visible text of markup, read by the HTML parser", () => {
  it("leaves out scripts and styles (also with a space in the closing tag), joins the pieces with a space and decodes entities", () => {
    const html = '<html><head><style>p{color:red}</style><script>var x = "<b>";</script ></head><body><p>Not a promise,</p><p>it&#x27;s &amp; yours</p></body></html>';
    expect(htmlText(html).replace(/\s+/g, " ").trim()).toBe("Not a promise, it's & yours");
  });
  it("leaves no tag behind for markup built to survive a one-pass strip", () => {
    expect(htmlText("<scr<script>ipt>alert(1)</scr</script>ipt>after")).not.toContain("<"); // (a ">" left in the text is text, not a tag)
  });
});

describe("escapeRegExp", () => {
  it("makes a pattern that matches exactly the text, backslashes and brackets included", () => {
    const hostile = "a.b*(c)[d]\\e/@f-g+h?";
    expect(new RegExp(`^${escapeRegExp(hostile)}$`).test(hostile)).toBe(true);
    expect(new RegExp(`^${escapeRegExp(hostile)}$`).test("aXb")).toBe(false);
  });
});
