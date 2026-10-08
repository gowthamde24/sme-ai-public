import { describe, expect, it } from "vitest";

import { WHATSAPP_CODES } from "./codes";
import { NOTHING_SENT, NO_POLICY_NOTE, SENT_AGAIN, WHATSAPP_SENTENCES } from "./sentences";

describe("the sentences", () => {
  it("there is exactly one fixed sentence per closed code, each ending in a full stop and each different", () => {
    expect(Object.keys(WHATSAPP_SENTENCES).sort()).toEqual([...WHATSAPP_CODES].sort());
    const all = Object.values(WHATSAPP_SENTENCES);
    expect(new Set(all).size).toBe(all.length);
    for (const s of all) expect(s).toMatch(/[a-z]\.$/);
  });
  it("none has a place for a number, a name, an address or a text", () => {
    for (const s of [...Object.values(WHATSAPP_SENTENCES), NOTHING_SENT, NO_POLICY_NOTE, SENT_AGAIN]) expect(s).not.toMatch(/\d{4}|wa\.me|\$\{|\{\}|undefined|null/);
  });
  it("say what the plan promised", () => {
    expect(WHATSAPP_SENTENCES.too_long).toContain("Copy text");
    expect(WHATSAPP_SENTENCES.not_from_here).toContain("Copy text");
    expect(WHATSAPP_SENTENCES.expired).toContain("copy the text");
    expect(NOTHING_SENT).toContain("Nothing is sent by this system");
    expect(SENT_AGAIN).toContain("another message");
  });
});
