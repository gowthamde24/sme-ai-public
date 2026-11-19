import { describe, expect, it } from "vitest";

import { fromSegments, readBox, segmentsToHtml, toSegments } from "./pills";
import { PLACEHOLDERS } from "./types";

const WORDS = { customer: "the customer's name", assistant: "your assistant's name", business: "your shop name", agent_role: "AI assistant" } as const;

describe("the greeting's pills <-> the stored placeholders", () => {
  it("round trip: every stored text comes back exactly (the saved payload is the one the API takes today)", () => {
    for (const s of [
      "Hello {customer}, this is {assistant}, the {agent_role} of {business}. Do you have a minute?",
      "నమస్కారం {customer} గారూ, నేను {assistant}, {business} {agent_role}. ఒక్క నిమిషం మాట్లాడొచ్చా?",
      "{customer}{customer}",
      "{business}",
      "No names at all.",
      "",
      "Odd {foo} stays text and {} too",
      "{customer",
    ]) expect(fromSegments(toSegments(s))).toBe(s);
  });
  it("only the four known placeholders are pills; other brace text stays text", () => {
    expect(toSegments("Hi {customer}! {foo}")).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "pill", name: "customer" },
      { kind: "text", text: "! {foo}" },
    ]);
    expect(PLACEHOLDERS).toEqual(["customer", "assistant", "business", "agent_role"]);
  });
  it("the box shows plain words and no curly braces", () => {
    const html = segmentsToHtml(toSegments("Hello {customer}, this is {assistant} of {business}, the {agent_role}."), (n) => WORDS[n]);
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(box.textContent).toBe("Hello the customer's name, this is your assistant's name of your shop name, the AI assistant.");
    expect(box.textContent).not.toMatch(/[{}]/);
    expect(box.querySelectorAll("[data-ph]").length).toBe(4);
  });
  it("reading the box back gives the stored text (typed text, pills, a break as a space, text is escaped)", () => {
    const box = document.createElement("div");
    box.innerHTML = segmentsToHtml(toSegments("Hi {customer} <b>&</b>"), (n) => WORDS[n]);
    expect(box.textContent).toContain("<b>&</b>");
    expect(readBox(box)).toBe("Hi {customer} <b>&</b>");
    box.appendChild(document.createElement("br"));
    box.appendChild(document.createTextNode("ok"));
    expect(readBox(box)).toBe("Hi {customer} <b>&</b> ok");
  });
});
