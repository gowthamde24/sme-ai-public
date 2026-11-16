import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The floating orb steps aside on a phone while a composer or a sticky Save bar is on the page (owner, 16 Nov): the rule is in the global CSS and the markers are where those things are drawn. */
describe("the orb steps aside for a composer on a phone", () => {
  const HIDE = "[body:has([data-orb-avoid])_&]:max-md:hidden";
  it("both orbs (the live one and the off one) hide below 768px when the page has a data-orb-avoid thing, and only then", () => {
    for (const f of ["components/v2/app/today/ask/AskFloating.tsx", "components/v2/app/today/ask/AskOffFloating.tsx"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).toContain(HIDE);
      expect(src, f).toContain('data-ask="orb"');
    }
  });
  it("the sticky Save bars and the practice composer are marked", () => {
    for (const f of ["components/v2/app/materials/ProductEditor.tsx", "components/v2/app/materials/PolicyForm.tsx", "components/v2/app/materials/QuoteBuilder.tsx", "components/v2/app/prospects/ProspectCards.tsx", "components/v2/app/assistant/TalkTraining.tsx", "components/v2/app/chats/v6/Conversation.tsx"]) expect(readFileSync(join(__dirname, "..", f), "utf8"), f).toContain("data-orb-avoid");
  });
});
