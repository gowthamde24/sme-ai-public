import { describe, expect, it } from "vitest";

import { closest, words } from "./match";

const OPTIONS = [
  { id: "a", name: "Bakery and sweets", tagline: "Custom orders and festival boxes", keywords: "bakery cake sweets mithai confectionery" },
  { id: "b", name: "Salon, beauty and spa", tagline: "Appointments and bridal bookings", keywords: "salon beauty parlour spa makeup hair" },
  { id: "c", name: "Gym and fitness", tagline: "Trial sessions and renewals", keywords: "gym fitness trainer workout" },
];

describe("Describe what you sell: the closest business type", () => {
  it("drops short and common words and keeps the letters of any script", () => {
    expect(words("We sell cakes and sweets in the shop")).toEqual(["cakes", "sweets"]);
    expect(words("కేక్ shop")).toEqual(["కేక్"]);
  });
  it("picks the type whose search words match, by whole word or by the start of a word", () => {
    expect(closest("we make cakes and mithai for weddings", OPTIONS)?.id).toBe("a");
    expect(closest("ladies parlour and bridal makeup", OPTIONS)?.id).toBe("b");
    expect(closest("personal trainer for workouts", OPTIONS)?.id).toBe("c");
  });
  it("says nothing when no word matches, and for an empty text", () => {
    expect(closest("we repair tractors", OPTIONS)).toBeNull();
    expect(closest("   ", OPTIONS)).toBeNull();
  });
  it("keeps the list's order on a tie", () => {
    expect(closest("mithai makeup", OPTIONS)?.id).toBe("a");
  });
});
