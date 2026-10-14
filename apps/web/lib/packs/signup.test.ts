import { describe, expect, it } from "vitest";

import { defaultBusinessName, parseSignupPack, signupCards } from "./signup";

describe("the sign-up cards", () => {
  it("are the packs a person may pick, in order, in the person's language", () => {
    expect(signupCards("en").map((c) => [c.id, c.name, c.icon, c.accent])).toEqual([
      ["textiles", "Textiles", "fabric", "rose"],
      ["construction", "Construction materials", "block", "terracotta"],
      ["education", "Education", "cap", "sky"],
    ]);
    expect(signupCards("te")[1].name).toBe("నిర్మాణ సామగ్రి");
    expect(signupCards("ta")[2].name).toBe("Education"); // a language with no text yet reads English
  });
  it("accept a kind of business only when it is a card: an address or a cookie is never trusted", () => {
    expect(parseSignupPack("education")).toBe("education");
    expect(parseSignupPack(["construction", "x"])).toBe("construction");
    for (const bad of [undefined, null, "", "other", "Textiles", "textiles ", "../x", "<b>", 7, {}, ["nope"]]) expect(parseSignupPack(bad), JSON.stringify(bad)).toBeNull();
  });
  it("name a new business neutrally until the checklist asks the real name", () => {
    expect(defaultBusinessName("construction", "en")).toBe("My business");
    expect(defaultBusinessName("education", "en")).toBe("My institution");
    expect(defaultBusinessName("education", "hi")).toBe("मेरा संस्थान");
    expect(defaultBusinessName("nope", "en")).toBe("My business");
  });
});
