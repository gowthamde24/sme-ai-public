import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseDraftAnswer, parseOwnMessage, parseOwnMessages } from "@/lib/api/template-builder-parse";
import { runChecks, warnings } from "@/lib/templates/meta-checks";
import { WIRE_OWN_MESSAGES, wireDraftFor, wireSubmitted } from "@/lib/templates/mock";

import type { BuilderActions } from "./builder-types";
import { OwnMessages } from "./OwnMessages";

afterEach(cleanup);
const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.tb.") || k.startsWith("jobs.kind.") || k === "today.err.generic"));
const ITEMS = parseOwnMessages(WIRE_OWN_MESSAGES);
const part = (n: string) => document.querySelector(`[data-part="${n}"]`) as HTMLElement;

/** The real mock writer behind the actions, as the server action would give it. */
function acts(over: Partial<BuilderActions> = {}): BuilderActions {
  return {
    write: vi.fn(async (text: string) => ({ ok: true as const, data: parseDraftAnswer(wireDraftFor(text)) })),
    submit: vi.fn(async (input) => ({ ok: true as const, data: parseOwnMessage(wireSubmitted("own-new", input.title, input.message.category, "2026-11-19T05:12:00Z")) })),
    ...over,
  };
}
const view = (a: BuilderActions | null = acts(), extra: { secondFactor?: boolean } = {}) =>
  render(<OwnMessages words={WORDS} items={ITEMS} actions={a} secondFactor={extra.secondFactor ?? true} mock securityHref="/app/security" jobsHref="/app/tenants/t/jobs" lang="en" business="Neelambari Silks" />);
async function written(text = "Tell customers the blouse is ready for pickup") {
  fireEvent.click(screen.getByRole("button", { name: "Make a new message" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Say what you want" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Write it for me" }));
  await waitFor(() => expect(part("step-written")).toBeTruthy());
}
const code = (v: string) => fireEvent.change(document.querySelector('input[name="code"]') as HTMLInputElement, { target: { value: v } });

describe("your own messages: the list and its statuses", () => {
  it("shows each message with Waiting for WhatsApp, Approved or Needs a change, and the reason in plain words", () => {
    view();
    const rows = [...document.querySelectorAll("[data-own]")];
    expect(rows.map((r) => r.getAttribute("data-own"))).toEqual(["waiting", "approved", "needs_change"]);
    expect(rows[0]).toHaveTextContent("Waiting for WhatsApp");
    expect(rows[0]).toHaveTextContent(/Sent 19 Nov/);
    expect(rows[0].querySelector('[data-part="track"]')).toBeTruthy();
    expect(rows[1]).toHaveTextContent("Approved");
    expect(within(rows[1] as HTMLElement).getByRole("link", { name: "Use it with a team member" })).toHaveAttribute("href", "/app/tenants/t/jobs");
    expect(rows[2]).toHaveTextContent("Needs a change");
    expect(rows[2]).toHaveTextContent("WhatsApp says this sounds like an offer, but you chose “about their order”. Take out the word discount, or send it as an offer instead.");
    expect(within(rows[2] as HTMLElement).getByRole("button", { name: "Change it by saying it" })).toBeInTheDocument();
  });
  it("uses no jargon on the screen: no template, variable, namespace, id or braces", () => {
    view();
    expect(document.body.textContent ?? "").not.toMatch(/template|variable|namespace|\{|\}|\bid\b/i);
  });
  it("a person who only reads has no button (nothing to make)", () => {
    view(null);
    expect(screen.queryByRole("button", { name: "Make a new message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change it by saying it" })).toBeNull();
  });
  it("an empty list says what to do", () => {
    render(<OwnMessages words={WORDS} items={[]} actions={acts()} secondFactor mock={false} securityHref="/s" jobsHref="/j" lang="en" business="X" />);
    expect(part("own-none")).toHaveTextContent("You have not made a message yet");
  });
});

describe("the builder: say it, written, preview, checks, send", () => {
  it("writes both languages from a sentence; the name is a plain Name chip and braces never show", async () => {
    const a = acts();
    view(a);
    await written();
    expect(a.write).toHaveBeenCalledWith("Tell customers the blouse is ready for pickup", null);
    const te = document.querySelector('[data-draft="te"]') as HTMLElement;
    const en = document.querySelector('[data-draft="en"]') as HTMLElement;
    expect(te.querySelectorAll('[data-part="name-chip"]')).toHaveLength(1);
    expect(en.querySelectorAll('[data-part="name-chip"]')).toHaveLength(1);
    expect(en).toHaveTextContent("Name, your blouse is READY for pickup at Neelambari Silks.");
    expect(part("builder").textContent).not.toMatch(/[{}]/);
    expect(part("builder").textContent).not.toMatch(/template|variable|namespace/i);
  });
  it("an unclear sentence keeps the box and says so; a refusal shows its sentence", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Make a new message" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Say what you want" }), { target: { value: "sing me a song" } });
    fireEvent.click(screen.getByRole("button", { name: "Write it for me" }));
    expect(await screen.findByText(/I could not tell what to write/)).toBeInTheDocument();
    expect(part("step-written")).toBeNull();
    cleanup();
    view(acts({ write: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "Not allowed." })) }));
    fireEvent.click(screen.getByRole("button", { name: "Make a new message" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Say what you want" }), { target: { value: "the blouse is ready" } });
    fireEvent.click(screen.getByRole("button", { name: "Write it for me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed.");
  });
  it("the live preview shows the sample name with a Telugu and English switch", async () => {
    view();
    await written();
    const bubble = () => part("wa-preview");
    expect(bubble()).toHaveAttribute("data-lang", "te");
    expect(bubble()).toHaveTextContent("నమస్కారం Lakshmi గారు");
    expect(bubble().querySelectorAll('[data-part="wa-button"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(bubble()).toHaveAttribute("data-lang", "en");
    expect(bubble()).toHaveTextContent("Lakshmi, your blouse is READY");
    expect(bubble().textContent).not.toMatch(/[{}]|Name/);
  });
  it("the checks: two amber warnings with a one-tap Fix each; Send is blocked until they are fixed", async () => {
    view();
    await written();
    expect(part("step-checks")).toHaveTextContent("2 to fix");
    expect([...document.querySelectorAll('[data-state="warn"]')].map((e) => e.getAttribute("data-check"))).toEqual(["capitals", "name_edge"]);
    expect(part("send-blocked")).toBeTruthy();
    expect(document.querySelector('input[name="code"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-check="capitals"] [data-action="fix"]') as HTMLElement);
    expect(part("step-checks")).toHaveTextContent("1 to fix");
    expect(document.querySelector('[data-draft="en"]')).toHaveTextContent("is ready for pickup");
    fireEvent.click(document.querySelector('[data-check="name_edge"] [data-action="fix"]') as HTMLElement);
    expect(part("step-checks")).toHaveTextContent("All good");
    expect(document.querySelector('[data-draft="en"]')).toHaveTextContent("Hello Name, your blouse");
    expect(part("send-blocked")).toBeNull();
  });
  it("Fix all fixes both at once", async () => {
    view();
    await written();
    fireEvent.click(screen.getByRole("button", { name: "Fix all" }));
    expect(part("step-checks")).toHaveTextContent("All good");
    expect(screen.queryByRole("button", { name: "Fix all" })).toBeNull();
  });
  it("Edit shows the name as [Name] (never braces) and reads it back; an edit that breaks a rule shows in the checks at once", async () => {
    view();
    await written();
    fireEvent.click(within(document.querySelector('[data-draft="en"]') as HTMLElement).getByRole("button", { name: "Edit" }));
    const body = screen.getByRole("textbox", { name: "message" }) as HTMLTextAreaElement;
    expect(body.value).toContain("[Name], your blouse");
    expect(body.value).not.toMatch(/[{}]/);
    fireEvent.change(body, { target: { value: "Hello [Name], your blouse is ready. {x}" } });
    expect(body.value).toBe("Hello [Name], your blouse is ready. x");
    expect(document.querySelector('[data-check="capitals"]')).toHaveAttribute("data-state", "ok");
  });
  it("Change by saying it asks the writer again with the message so far", async () => {
    const a = acts();
    view(a);
    await written();
    fireEvent.click(screen.getByRole("button", { name: "Change by saying it" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Change by saying it" }), { target: { value: "make it about delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Change it" }));
    await waitFor(() => expect(a.write).toHaveBeenCalledTimes(2));
    expect((a.write as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("make it about delivery");
    expect((a.write as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ category: "utility" });
    await waitFor(() => expect(part("step-checks")).toHaveTextContent("All good"));
  });
});

describe("sending needs the second step", () => {
  async function ready(a: BuilderActions, secondFactor = true) {
    view(a, { secondFactor });
    await written();
    fireEvent.click(screen.getByRole("button", { name: "Fix all" }));
  }
  it("asks for the six digits of the two-step code; Send stays off until all six are typed; letters are ignored", async () => {
    const a = acts();
    await ready(a);
    const send = screen.getByRole("button", { name: "Send to WhatsApp" });
    expect(part("second-step")).toHaveTextContent("Saving needs your two-step code first.");
    expect(send).toBeDisabled();
    code("48a2");
    expect((document.querySelector('input[name="code"]') as HTMLInputElement).value).toBe("482");
    expect(send).toBeDisabled();
    code("482913");
    expect(send).toBeEnabled();
    expect(a.submit).not.toHaveBeenCalled();
  });
  it("sends the checked message and the code, then Waiting for WhatsApp is at the top of the list and the builder closes", async () => {
    const a = acts();
    await ready(a);
    code("482913");
    fireEvent.click(screen.getByRole("button", { name: "Send to WhatsApp" }));
    await waitFor(() => expect(a.submit).toHaveBeenCalledTimes(1));
    const [input, sentCode] = (a.submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sentCode).toBe("482913");
    expect(input.title).toEqual({ en: "Blouse ready for pickup", te: "Blouse రెడీ" });
    expect(warnings(runChecks(input.message))).toEqual([]);
    expect(await screen.findByText(/Sent\. WhatsApp is checking it/)).toBeInTheDocument();
    expect(part("builder")).toBeNull();
    const first = document.querySelector("[data-own]") as HTMLElement;
    expect(first).toHaveAttribute("data-own", "waiting");
    expect(first).toHaveTextContent("Blouse ready for pickup");
    expect(document.querySelectorAll("[data-own]")).toHaveLength(4);
  });
  it("a wrong code shows the refusal and keeps the builder", async () => {
    const a = acts({ submit: vi.fn(async () => ({ ok: false as const, kind: "invalid" as const, code: "bad_code", error: "That code did not work. Use the newest code from your code app." })) });
    await ready(a);
    code("111111");
    fireEvent.click(screen.getByRole("button", { name: "Send to WhatsApp" }));
    expect(await screen.findByText(/That code did not work/)).toBeInTheDocument();
    expect(part("builder")).toBeTruthy();
  });
  it("a person with no authenticator gets a plain Confirm step: no code box, one button that sends with an empty code (owner 20 Nov)", async () => {
    const a = acts();
    await ready(a, false);
    expect(part("confirm-step")).toHaveTextContent("Send to WhatsApp?");
    expect(document.querySelector('input[name="code"]')).toBeNull();
    expect(part("no-factor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
    await waitFor(() => expect(a.submit).toHaveBeenCalledTimes(1));
    expect((a.submit as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe("");
  });
  it("an `mfa` refusal from the server turns the code box into the Security link", async () => {
    const a = acts({ submit: vi.fn(async () => ({ ok: false as const, kind: "mfa" as const, mfa: true, error: "You have not set up your two-step code yet. Set it up in Security, then come back here." })) });
    await ready(a);
    code("482913");
    fireEvent.click(screen.getByRole("button", { name: "Send to WhatsApp" }));
    expect(await screen.findByRole("link", { name: "Open Security" })).toBeInTheDocument();
  });
  it("the mock says nothing is sent or saved", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Make a new message" }));
    expect(await screen.findByText("Test mode: nothing is sent to WhatsApp and nothing is saved.")).toBeInTheDocument();
  });
});

describe("Use it in a job: a plain sentence with the choice inside", () => {
  const JOBS = [{ id: "66666666-6666-4666-8666-666666666606", kind: "offers", customName: null }, { id: "66666666-6666-4666-8666-666666666605", kind: "store_visits", customName: "Priya" }];
  const approved = () => document.querySelector('[data-own="approved"]') as HTMLElement;
  const withJobs = (a: BuilderActions | null, jobs = JOBS) => render(<OwnMessages words={WORDS} items={ITEMS} actions={a} jobs={jobs} secondFactor mock securityHref="/app/security" jobsHref="/app/tenants/t/jobs" lang="en" business="Neelambari Silks" />);
  it("an approved message offers the jobs that send offers, follow-ups or visits; the sentence has the choice inside", async () => {
    const use = vi.fn(async (jobId: string, messageId: string | null) => ({ ok: true as const, data: { jobId, messageId } }));
    withJobs(acts({ use }));
    expect(within(approved()).queryByRole("link", { name: "Use it with a team member" })).toBeNull();
    fireEvent.click(within(approved()).getByRole("button", { name: "Use it with a team member" }));
    const choice = within(approved()).getByRole("combobox", { name: "Which team member" }) as HTMLSelectElement;
    expect([...choice.options].map((o) => o.textContent)).toEqual(["Offer sender", "Priya"]);
    expect(approved().querySelector('[data-part="use-in-job"]')?.textContent).toMatch(/^Let .* send this message\.Use it$/);
    fireEvent.change(choice, { target: { value: JOBS[1].id } });
    fireEvent.click(within(approved()).getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(use).toHaveBeenCalledWith(JOBS[1].id, "own-visit-reminder"));
    expect(await within(approved()).findByText("Priya now sends this message.")).toBeInTheDocument();
    fireEvent.click(within(approved()).getByRole("button", { name: "Back to the standard message" }));
    await waitFor(() => expect(use).toHaveBeenLastCalledWith(JOBS[1].id, null));
    await waitFor(() => expect(within(approved()).getByRole("button", { name: "Use it with a team member" })).toBeInTheDocument());
  });
  it("only approved messages have it: not one waiting or sent back", () => {
    withJobs(acts({ use: vi.fn() }));
    expect(document.querySelectorAll('[data-action="use-in-job"]')).toHaveLength(1);
  });
  it("a no from the API (setting_invalid on message_id) is said in plain words and nothing changes on the screen", async () => {
    const use = vi.fn(async () => ({ ok: false as const, kind: "invalid" as const, error: "That choice was not accepted. Pick another one.", fields: ["message_id"] }));
    withJobs(acts({ use }));
    fireEvent.click(within(approved()).getByRole("button", { name: "Use it with a team member" }));
    fireEvent.click(within(approved()).getByRole("button", { name: "Use it" }));
    expect(await within(approved()).findByText("That choice was not accepted. Pick another one.")).toBeInTheDocument();
    expect(within(approved()).queryByText(/now sends this message/)).toBeNull();
  });
  it("no job that sends it, or a person who only reads: the plain link to the Jobs page it always was", () => {
    withJobs(acts({ use: vi.fn() }), []);
    expect(within(approved()).getByRole("link", { name: "Use it with a team member" })).toHaveAttribute("href", "/app/tenants/t/jobs");
    cleanup();
    withJobs(null);
    expect(within(approved()).getByRole("link", { name: "Use it with a team member" })).toHaveAttribute("href", "/app/tenants/t/jobs");
  });
});
