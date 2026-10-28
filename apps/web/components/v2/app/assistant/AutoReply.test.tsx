import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RULES, type AutoReply as State } from "@/lib/auto-reply/types";

import { AutoReply } from "./AutoReply";

const OFF: State = { enabled: false, changedAt: null, answeredToday: 0, heldToday: 0, dailyLimit: 200, rules: [...RULES] };
const ON: State = { ...OFF, enabled: true, answeredToday: 7, heldToday: 2 };
afterEach(cleanup);
const show = (initial: State, change = vi.fn(), canEdit = true) => render(<AutoReply initial={initial} canEdit={canEdit} change={change} securityHref="/app/security" />);

describe("Automatic replies", () => {
  it("says in plain words what it does and its three rules, and that turning it on approves them", () => {
    show(OFF);
    expect(screen.getByText("Off")).toBeInTheDocument();
    for (const r of ["It answers only within 24 hours of the customer's message.", "A price, a discount or a promise always waits for you.", "If it is unsure, the customer is upset, or asks for a person, it hands over to you."]) expect(screen.getByText(r)).toBeInTheDocument();
    expect(screen.getByText("Turning it on is your approval of these rules, for every message.")).toBeInTheDocument();
    expect(document.querySelector('[data-part="auto-reply-today"]')).toBeNull(); // no counts while it is off
  });
  it("turns on with one tap and shows what the API answered, with today's counts", async () => {
    const change = vi.fn(async () => ({ ok: true as const, data: ON }));
    show(OFF, change);
    fireEvent.click(screen.getByRole("button", { name: "Turn on automatic replies" }));
    await waitFor(() => expect(screen.getByText("Automatic replies are on.")).toBeInTheDocument());
    expect(change).toHaveBeenCalledWith(true);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(document.querySelector('[data-part="auto-reply-today"]')).toHaveTextContent("7 answered by itself, 2 waiting for you (at most 200 a day)");
    expect(screen.getByRole("button", { name: "Turn off automatic replies" })).toBeInTheDocument();
  });
  it("turns off again and says every message waits for the owner", async () => {
    const change = vi.fn(async () => ({ ok: true as const, data: OFF }));
    show(ON, change);
    fireEvent.click(screen.getByRole("button", { name: "Turn off automatic replies" }));
    await waitFor(() => expect(screen.getByText("Automatic replies are off. Every message waits for you again.")).toBeInTheDocument());
    expect(change).toHaveBeenCalledWith(false);
  });
  it("a missing two-step code is said in words with a link to Security, and the switch stays as it was", async () => {
    show(OFF, vi.fn(async () => ({ ok: false as const, error: "mfa" as const })));
    fireEvent.click(screen.getByRole("button", { name: "Turn on automatic replies" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("two-step code");
    expect(alert.querySelector("a")?.getAttribute("href")).toBe("/app/security");
    expect(screen.getByText("Off")).toBeInTheDocument();
  });
  it("only the Owner has the button; everyone else reads", () => {
    show(ON, vi.fn(), false);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Only the Owner can turn this on or off.")).toBeInTheDocument();
  });
});
