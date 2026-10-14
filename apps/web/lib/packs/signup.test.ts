import { describe, expect, it } from "vitest";

import { parsePackSummary } from "@/lib/api/pack";
import { packsWire, selectableIds } from "@/lib/packs/pack-test-kit";

import { DEFAULT_BUSINESS_NAME, parseSignupPack, pickSignupPack, signupCards } from "./signup";

const packs = packsWire().packs.map(parsePackSummary);

describe("the sign-up cards", () => {
  it("are the business types the API offers, in its order, in the person's language, with their accent and owl prop", () => {
    const cards = signupCards(packs, "en");
    expect(cards.map((c) => c.id)).toEqual(selectableIds());
    for (const c of cards) expect(c).toMatchObject({ name: expect.any(String), tagline: expect.any(String), accent: expect.stringMatching(/^[a-z_]+$/), owlProp: expect.stringMatching(/^[a-z_]+$/) });
    expect(signupCards(packs, "te")[1].name).toBe(packs[1].names.te);
    expect(signupCards(packs, "ta")[1].name).toBe(packs[1].names.en); // a language with no text yet reads English
  });
  it("say which types no real owner has reviewed yet", () => {
    expect(signupCards(packs, "en").some((c) => !c.validated)).toBe(true);
    expect(signupCards(packs, "en").some((c) => c.validated)).toBe(true);
  });
  it("accept a kind of business by its shape, and only a card the API offers once the cards are known: an address or a cookie is never trusted", () => {
    const id = selectableIds()[1];
    expect(parseSignupPack(id)).toBe(id);
    expect(parseSignupPack([id, "x"])).toBe(id);
    expect(pickSignupPack(packs, id)).toBe(id);
    expect(pickSignupPack(packs, "a_type_nobody_offers")).toBeNull();
    for (const bad of [undefined, null, "", "Textiles", "x", "textiles ", "../x", "<b>", 7, {}, ["Nope"], "a".repeat(40)]) expect(parseSignupPack(bad), JSON.stringify(bad)).toBeNull();
  });
  it("name a new business neutrally until the checklist asks the real name", () => {
    expect(DEFAULT_BUSINESS_NAME).toBe("My business");
  });
});
