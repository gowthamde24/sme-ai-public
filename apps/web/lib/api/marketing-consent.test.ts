import { describe, expect, it } from "vitest";

import { parseItem, parseList, parseOne, tidyNote } from "./marketing-consent";

const ID = "11111111-2222-4333-8444-555555555555";
const row = { contact_id: ID, name: "Ramesh K.", phone: "+919999999999", state: "granted", at: "2026-11-17T10:00:00Z", via: "owner_recorded", by: "Owner", note: "said yes in shop", stopped: false };

describe("marketing consent answers", () => {
  it("reads a row and never keeps the phone number", () => {
    const r = parseItem(row);
    expect(r.phone).toBeNull();
    expect(r).toMatchObject({ name: "Ramesh K.", state: "granted", via: "owner_recorded", note: "said yes in shop", stopped: false });
  });
  it("reads the list with the counts of the whole book", () => {
    const l = parseList({ items: [row], counts: { granted: 1, unknown: 317, withdrawn: 0 }, next_cursor: null });
    expect(l.counts).toEqual({ granted: 1, unknown: 317, withdrawn: 0 });
    expect(l.items).toHaveLength(1);
  });
  it("leaves out one bad row, not the whole list", () => {
    const l = parseList({ items: [row, { ...row, state: "maybe" }], counts: { granted: 1, unknown: 0, withdrawn: 0 }, next_cursor: null });
    expect(l.items).toHaveLength(1);
  });
  it("refuses an answer that is not the contract's shape", () => {
    expect(() => parseList({ items: [], counts: { granted: "1" }, next_cursor: null })).toThrow();
    expect(() => parseOne({ state: "yes" })).toThrow();
  });
  it("tidies the note and keeps it between 2 and 160 characters", () => {
    expect(tidyNote("  said   yes in shop ")).toBe("said yes in shop");
    expect(tidyNote("a")).toBeNull();
    expect(tidyNote("x".repeat(161))).toBeNull();
    expect(tidyNote("x".repeat(160))).toHaveLength(160);
  });
});
