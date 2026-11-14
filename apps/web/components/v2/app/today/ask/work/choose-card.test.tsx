import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { fixtureTransport } from "@/lib/assistant-work/client";
import { parseWorkCard } from "@/lib/assistant-work/types";

import { makeT } from "../../../words";
import { WorkCards } from "./WorkCards";
import type { WorkEnv } from "./work-env";
import { createWorkStore } from "./work-store";

afterEach(cleanup);
const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const BASE = "/app/tenants/c029cba3-d2f8-4923-8c5a-630852797fd3";
const json = (over: Record<string, unknown> = {}) => ({ kind: "choose", id: "b5000000-0000-4000-8000-000000000001", question: "Which Kalyani?", options: [{ label: "Kalyani Gowda", value: "Kalyani Gowda" }, { label: "Kalyani Shetty", value: "Kalyani Shetty" }, { label: "Kalyani Iyer", value: "Kalyani Iyer" }], ...over });
const draw = (card: unknown, onSend: ((t: string) => void) | undefined) => {
  const parsed = parseWorkCard(card, BASE);
  if (!parsed) throw new Error("does not parse");
  const env: WorkEnv = { t: makeT(WORDS), role: "owner", transport: fixtureTransport({ delay: 0 }), store: createWorkStore(), onChange: () => undefined, onSend };
  return render(<WorkCards cards={[parsed]} env={env} />);
};

describe("the 'Which Kalyani?' buttons", () => {
  it("reads two to six options and nothing else", () => {
    expect(parseWorkCard(json(), BASE)).toMatchObject({ kind: "choose", question: "Which Kalyani?" });
    expect(parseWorkCard(json({ options: [{ label: "Only one", value: "x" }] }), BASE)).toBeNull();
    expect(parseWorkCard(json({ question: "" }), BASE)).toBeNull();
    const many = parseWorkCard(json({ options: Array.from({ length: 9 }, (_, i) => ({ label: `Name ${i}`, value: `Name ${i}` })) }), BASE);
    expect(many && many.kind === "choose" ? many.options.length : 0).toBe(6);
    const noValue = parseWorkCard(json({ options: [{ label: "A" }, { label: "B", value: "b" }] }), BASE);
    expect(noValue && noValue.kind === "choose" ? noValue.options.map((o) => o.value) : []).toEqual(["A", "b"]); // the label is the value when none is given
  });

  it("a tap sends the option as the next message, once; the other buttons go off and the chosen one is marked", () => {
    const send = vi.fn();
    draw(json(), send);
    fireEvent.click(screen.getByRole("button", { name: "Kalyani Shetty" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Kalyani Shetty");
    expect(screen.getByRole("button", { name: "Kalyani Shetty" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Kalyani Gowda" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Kalyani Gowda" }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sent your choice.")).toBeTruthy();
  });

  it("with no way to send (a preview) the buttons are off, not silent", () => {
    draw(json(), undefined);
    expect((screen.getByRole("button", { name: "Kalyani Gowda" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
