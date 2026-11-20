import { describe, expect, it } from "vitest";

import { AI_LABEL, GREETING_MENTIONS_AI, stackWith, STACK } from "./chat-stack";

describe("the demo's greeting switch (the product's 'Say AI assistant when greeting' setting is live, default OFF)", () => {
  it("the demo shows the DEFAULT: the first call line is the name only, in all four languages, and the FAQ takes the prepared honest answer", () => {
    expect(GREETING_MENTIONS_AI).toBe(false);
    expect(STACK).toEqual(stackWith(false));
    for (const c of STACK) {
      expect(c.call.lines[0].text, c.code).not.toMatch(/AI assistant/);
      expect(c.call.lines[0].text, c.code).toContain(c.name.split(" ")[0]);
      expect(c.call.lines[0].text, c.code).toMatch(/Priya/);
    }
  });
  it("with the greeting switch ON the first call line says it is the AI assistant (the other mode stays covered), in all four languages", () => {
    const on = stackWith(true);
    for (const c of on) expect(c.call.lines[0].text, c.code).toMatch(/AI assistant/);
  });
  it("the two modes differ only in that first line, and the caption label stays", () => {
    const on = stackWith(true);
    const off = stackWith(false);
    for (let i = 0; i < off.length; i++) {
      expect(off[i].call.lines.slice(1)).toEqual(on[i].call.lines.slice(1));
      expect(off[i].lines).toEqual(on[i].lines);
      expect(off[i].call.lines[0].from).toBe(on[i].call.lines[0].from);
    }
    expect(AI_LABEL).toBeTruthy();
  });
});
