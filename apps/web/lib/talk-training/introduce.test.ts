import { describe, expect, it } from "vitest";

import { cleanIntroduce, INTRODUCE_DEFAULT, introducePreview, introduceProblem, introduceToApi, parseIntroduceAs, type IntroduceAs } from "./introduce";
import { cleanEdit, fromApi, toApi } from "./types";

const ow = (text: string): IntroduceAs => ({ kind: "owner", text });
const cu = (text: string): IntroduceAs => ({ kind: "custom", text });
const DOC = { greeting: {}, address: "plain", questions: ["Which colour?"], never_say: ["guaranteed"], objections: [], examples: [] };

describe("Introduce as: the contract's rules (docs/contracts/talk-training.md, 11 Nov), said as it is typed", () => {
  it("the business takes no text", () => {
    expect(introduceProblem(INTRODUCE_DEFAULT)).toBeNull();
    expect(introduceProblem({ kind: "business", text: "Gowtham" })).toBe("business_text");
  });
  it("the owner's name: letters only, 2 to 40 characters (names with a space are fine; Telugu letters and their marks count as letters)", () => {
    expect(introduceProblem(ow("Gowtham"))).toBeNull();
    expect(introduceProblem(ow("Gowtham Reddy"))).toBeNull();
    expect(introduceProblem(ow("గౌతమ్"))).toBeNull();
    expect(introduceProblem(ow("G"))).toBe("short");
    expect(introduceProblem(ow("x".repeat(41)))).toBe("long");
    expect(introduceProblem(ow("Gowtham 2"))).toBe("digit");
    expect(introduceProblem(ow("గౌతమ్౨"))).toBe("digit"); // Telugu digits too
    expect(introduceProblem(ow("Gowtham!"))).toBe("letters");
    expect(introduceProblem(ow("Go  wtham"))).toBe("letters"); // two spaces: not a name
  });
  it("own words: 8 to 60 characters, must say \"AI assistant\", no digit of any script, no link or e-mail address, no braces, never human or person", () => {
    expect(introduceProblem(cu("Gowtham's AI assistant"))).toBeNull();
    expect(introduceProblem(cu("the ai assistant of Lakshmi Silks"))).toBeNull();
    expect(introduceProblem(cu("AI assist"))).toBe("no_ai");
    expect(introduceProblem(cu("Priya from the shop"))).toBe("no_ai");
    expect(introduceProblem(cu("AI assistant"))).toBeNull();
    expect(introduceProblem(cu("short"))).toBe("short");
    expect(introduceProblem(cu(`${"a".repeat(55)} AI assistant`))).toBe("long");
    expect(introduceProblem(cu("Gowtham's AI assistant 2"))).toBe("digit");
    expect(introduceProblem(cu("గౌతమ్ AI assistant ౨"))).toBe("digit");
    expect(introduceProblem(cu("AI assistant at shop.com"))).toBe("link");
    expect(introduceProblem(cu("AI assistant a@b.in"))).toBe("link");
    expect(introduceProblem(cu("AI assistant www.shop.in"))).toBe("link");
    expect(introduceProblem(cu("AI assistant {name}"))).toBe("braces");
    expect(introduceProblem(cu("a human AI assistant"))).toBe("human");
    expect(introduceProblem(cu("a real person, AI assistant"))).toBe("human");
    expect(introduceProblem(cu("Gowtham's AI assistant, not a Person"))).toBe("human");
    expect(introduceProblem(cu("గౌతమ్ గారి AI అసిస్టెంట్"))).toBeNull(); // the language's own script: the API judges its words
    expect(introduceProblem(cu("మనిషి అయిన AI అసిస్టెంట్"))).toBe("human");
  });
  it("the text is sent trimmed and with single spaces; the business has none; the API's answer is read closed", () => {
    expect(cleanIntroduce(cu("  Gowtham's   AI assistant "))).toEqual({ kind: "custom", text: "Gowtham's AI assistant" });
    expect(cleanIntroduce({ kind: "business", text: "x" })).toEqual({ kind: "business", text: null });
    expect(introduceToApi(INTRODUCE_DEFAULT)).toEqual({ kind: "business", text: null });
    expect(parseIntroduceAs({ kind: "owner", text: "Gowtham" })).toEqual({ kind: "owner", text: "Gowtham" });
    expect(parseIntroduceAs({ kind: "business", text: null })).toEqual(INTRODUCE_DEFAULT);
    expect(parseIntroduceAs({ kind: "robot", text: "x" })).toBeNull();
    expect(parseIntroduceAs({ kind: "owner" })).toBeNull();
    expect(parseIntroduceAs(null)).toBeNull();
  });
  it("the preview is the opening sentence; an empty name shows its place, never a blank", () => {
    const tpl = { business: "Hello, this is the AI assistant of {business}.", owner: "Hello, this is {name}'s AI assistant.", custom: "Hello, this is {text}." };
    expect(introducePreview(INTRODUCE_DEFAULT, "Lakshmi Silks", tpl)).toBe("Hello, this is the AI assistant of Lakshmi Silks.");
    expect(introducePreview(ow(" Gowtham "), null, tpl)).toBe("Hello, this is Gowtham's AI assistant.");
    expect(introducePreview(ow(""), null, tpl)).toBe("Hello, this is …'s AI assistant.");
    expect(introducePreview(cu("Gowtham's AI assistant"), null, tpl)).toBe("Hello, this is Gowtham's AI assistant.");
    expect(introducePreview(INTRODUCE_DEFAULT, null, tpl)).toBe("Hello, this is the AI assistant of ….");
  });
});

describe("Introduce as in the Talk training document", () => {
  it("an API that has the field: read, kept and sent back; an API that has not: null, and nothing is sent", () => {
    const withIt = fromApi({ ...DOC, introduce_as: { kind: "owner", text: "Gowtham" } });
    expect(withIt?.introduceAs).toEqual({ kind: "owner", text: "Gowtham" });
    expect(toApi(withIt!)).toMatchObject({ introduce_as: { kind: "owner", text: "Gowtham" } });
    const without = fromApi(DOC);
    expect(without?.introduceAs).toBeNull();
    expect("introduce_as" in toApi(without!)).toBe(false);
    expect(fromApi({ ...DOC, introduce_as: { kind: "robot" } })).toBeNull(); // an odd answer refuses the whole
  });
  it("a save is checked with the API's own rules first; a good one is cleaned", () => {
    const edit = { greeting: {}, address: "plain", questions: ["Which colour?"], neverSay: ["guaranteed"], objections: [], examples: [], sayLike: null };
    expect(cleanEdit({ ...edit, introduceAs: cu("a human AI assistant") })).toEqual({ ok: false, error: "introduce_as" });
    expect(cleanEdit({ ...edit, introduceAs: { kind: "robot", text: "x" } })).toEqual({ ok: false, error: "introduce_as" });
    const ok = cleanEdit({ ...edit, introduceAs: cu("  Gowtham's  AI assistant ") });
    expect(ok.ok && ok.data.introduceAs).toEqual({ kind: "custom", text: "Gowtham's AI assistant" });
    const none = cleanEdit(edit);
    expect(none.ok && none.data.introduceAs).toBeNull();
  });
});
