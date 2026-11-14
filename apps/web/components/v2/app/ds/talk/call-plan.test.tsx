import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseCallPlan } from "@/lib/api/plan-extras";

import { CallPlanLines } from "./CallPlanLines";

afterEach(cleanup);
const dict = appDict("en") as Record<string, string>;
const t = (k: string) => dict[k] ?? k; // the typed chat's words: no placeholder filling of its own
const RAW = {
  people: [{ name: "Ravi", phone_masked: "•••• 0998", lead_id: "l1" }, { name: "Anitha", phone_masked: null, lead_id: null }],
  count: 7,
  goal: "Find out if Ravi is interested in the 2BHK and wants a site visit",
  opening_line: "Hello Ravi, I am an AI assistant calling for Sri Lakshmi Silks.",
  questions: [{ id: "q1", text: "Are you still interested in the 2BHK?", type: "text" }, { id: "q2", text: "Would you like a site visit?", type: "yes_no" }],
  outcomes: [{ when: "They answer", then: "I save each answer and a short summary with the call and tell you here" }, { when: "No answer", then: "I mark them as not reached and tell you" }],
};

describe("the call plan on a plan card", () => {
  it("reads the contract's shape: masked numbers only, no outcome the API did not list", () => {
    const p = parseCallPlan(RAW)!;
    expect(p.people).toEqual([{ name: "Ravi", phoneMasked: "•••• 0998", leadId: "l1" }, { name: "Anitha", phoneMasked: null, leadId: null }]);
    expect(p.count).toBe(7);
    expect(p.questions.map((q) => q.text)).toEqual(["Are you still interested in the 2BHK?", "Would you like a site visit?"]);
    expect(p.outcomes).toHaveLength(2);
    expect(parseCallPlan({ ...RAW, goal: "" })).toBeNull();
    expect(parseCallPlan({ ...RAW, questions: [] })).toBeNull();
    expect(parseCallPlan(null)).toBeNull();
    expect(parseCallPlan({ ...RAW, people: [{ name: "X", phone_masked: "+91 9876543210 call me" }] })!.people[0].phoneMasked).toBeNull(); // not a mask: dropped
  });

  it("draws who, goal, the opening, the questions and what happens after each outcome", () => {
    render(<CallPlanLines plan={parseCallPlan(RAW)!} t={t} />);
    expect(document.querySelector('[data-part="call-plan-who"]')?.textContent).toBe("Calling: Ravi · •••• 0998, Anitha · no number yet +5 more");
    expect(document.querySelector('[data-part="call-plan-goal"]')?.textContent).toContain("Find out if Ravi is interested");
    expect(document.querySelector('[data-part="call-plan-opening"]')?.textContent).toContain("I am an AI assistant");
    expect(document.querySelectorAll('[data-part="call-plan-questions"] li')).toHaveLength(2);
    expect(document.querySelector('[data-part="call-plan-outcomes"]')?.textContent).toContain("No answer → I mark them as not reached");
    expect(document.body.textContent).not.toContain("book a visit");
  });

  it("without a way to send (Talk live) it says how to change the questions in words; no buttons", () => {
    render(<CallPlanLines plan={parseCallPlan(RAW)!} t={t} />);
    expect(document.body.textContent).toContain("To change the questions, say for example: also ask about the loan.");
    expect(document.querySelector('[data-call-plan="remove"]')).toBeNull();
  });

  it("in the typed chat each question can be removed, and a question added: both are ordinary messages", () => {
    const say = vi.fn();
    render(<CallPlanLines plan={parseCallPlan(RAW)!} t={t} onSay={say} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove question 2" }));
    expect(say).toHaveBeenLastCalledWith("remove question 2");
    fireEvent.change(screen.getByRole("textbox", { name: "Add a question" }), { target: { value: "what is your budget?" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(say).toHaveBeenLastCalledWith("also ask: what is your budget?");
  });

  it("once answered the card is locked: no editing", () => {
    render(<CallPlanLines plan={parseCallPlan(RAW)!} t={t} onSay={vi.fn()} locked />);
    expect(document.querySelector('[data-call-plan="remove"]')).toBeNull();
    expect(document.querySelector('[data-call-plan="add"]')).toBeNull();
  });
});
