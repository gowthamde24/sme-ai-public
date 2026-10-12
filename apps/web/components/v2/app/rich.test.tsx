import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Rich } from "./rich";
import { makeT } from "./words";

const t = makeT({ "x.line": "Added {name}. {link} is next, by {who}.", "x.plain": "Hello {n}" });

describe("Rich", () => {
  it("puts the parts where the sentence has its markers", () => {
    const html = renderToStaticMarkup(<Rich t={t} k="x.line" with={{ name: <strong>Asha</strong>, link: <a href="/x">Open</a> }} vars={{ who: "me" }} />);
    expect(html).toBe('Added <strong>Asha</strong>. <a href="/x">Open</a> is next, by me.');
  });
  it("keeps an unfilled marker visible and fills plain variables", () => {
    expect(renderToStaticMarkup(<Rich t={t} k="x.line" />)).toBe("Added {name}. {link} is next, by {who}.");
    expect(renderToStaticMarkup(<Rich t={t} k="x.plain" vars={{ n: 3 }} />)).toBe("Hello 3");
  });
  it("shows a missing key as itself", () => {
    expect(renderToStaticMarkup(<Rich t={t} k="x.none" />)).toBe("x.none");
  });
});
