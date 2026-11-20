import { describe, expect, it } from "vitest";

import { GREETING_MENTIONS_AI, stackWith, STACK } from "./chat-stack";

describe("the demo's greeting switch (the product's 'Say AI assistant when greeting' setting is not live yet)", () => {
  it("today the first call line says it is the AI assistant (the product does), in all four languages", () => {
    expect(GREETING_MENTIONS_AI).toBe(true);
    expect(STACK).toBe(stackWith(true));
    for (const c of STACK) expect(c.call.lines[0].text, c.code).toMatch(/AI assistant/);
  });
  it("the name-only alternative changes only that first line, and the caption label stays", () => {
    const quiet = stackWith(false);
    for (let i = 0; i < quiet.length; i++) {
      expect(quiet[i].call.lines[0].text, quiet[i].code).not.toMatch(/AI assistant/);
      expect(quiet[i].call.lines[0].text).toContain(quiet[i].name.split(" ")[0]);
      expect(quiet[i].call.lines.slice(1)).toEqual(STACK[i].call.lines.slice(1));
      expect(quiet[i].lines).toEqual(STACK[i].lines);
    }
  });
});
