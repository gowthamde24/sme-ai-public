// @vitest-environment node
/** On a phone every tappable thing is at least 44px tall (T006b M0). jsdom cannot measure layout, so this pins the CSS
 * rule and the pages' use of it; `e2e/` measures the real thing in a browser on demand. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../../../..");
const css = readFileSync(path.join(WEB, "app/globals.css"), "utf8");
const phone = css.slice(css.indexOf("@media (max-width: 640px), (pointer: coarse)"));

describe("touch targets", () => {
  it("the phone rule gives buttons, selects, inputs, summaries and .tap links a 44px minimum", () => {
    expect(phone).toMatch(/button,\s*select,[\s\S]*summary,\s*\.tap\s*\{\s*min-height: 44px;/);
    expect(phone).toMatch(/a\.tap,\s*a\.button,[\s\S]*display: inline-flex;/);
  });

  it("every link of the review queue page carries the tap class", () => {
    const page = readFileSync(path.join(WEB, "app/app/tenants/[tenantId]/review/page.tsx"), "utf8");
    const links = [...page.matchAll(/<(Link|a)\b[^>]*?>/g)].map((m) => m[0]);
    expect(links.length).toBeGreaterThan(8);
    const withoutTap = links.filter((l) => !/className=(["{][^>]*)\btap\b|className="button tap"/.test(l) && !/rel="next"/.test(l));
    expect(withoutTap.map((l) => l.replace(/\s+/g, " ").slice(0, 70))).toEqual([]);
  });

  it("every link on every page, and the label of every radio and checkbox, is a 44px target on a phone", () => {
    expect(phone).toMatch(/main a,\s*main label:has\(> input\[type="radio"\]\),\s*main label:has\(> input\[type="checkbox"\]\) \{[^}]*min-height: 44px;[^}]*min-width: 44px;/);
    expect(phone).toMatch(/input\[type="radio"\],\s*input\[type="checkbox"\] \{\s*width: 24px;/);
  });

  it("the label buttons stretch to fill the row on a phone", () => {
    expect(phone).toMatch(/\.review-actions button \{\s*flex: 1 1 5\.5rem;/);
  });
});
