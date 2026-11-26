import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { mockJobDetail } from "@/lib/jobs/detail-mock";
import { MOCK_JOBS } from "@/lib/jobs/mock";

import { JobPage } from "./JobPage";
import type { JobPageActions } from "./types";

vi.mock("./LazyJobLists", async () => ({
  ...(await import("./JobLists")),
  FailureCard: (await import("./JobFailure")).FailureCard,
  JobRenameForm: (await import("./JobRenameForm")).JobRenameForm,
  TryCard: (await import("./JobTry")).TryCard,
  WhoTalks: (await import("./WhoTalks")).WhoTalks,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const detailOf = (kind: string) => mockJobDetail(MOCK_JOBS.find((j) => j.kind === kind)!.id)!;
const patched = (over = {}) => ({ ok: true as const, data: { customName: null, enabled: true, status: "running" as const, says: null, ...over } });
const acts = (over: Partial<JobPageActions> = {}): JobPageActions => ({
  setEnabled: vi.fn(async (enabled: boolean) => ({ ok: true as const, data: { id: "x", enabled, status: enabled ? ("running" as const) : ("paused" as const) } })),
  rename: vi.fn(async (name: string) => patched({ customName: name === "" ? null : name, says: [{ language: "en", channel: "call" as const, text: `This is ${name}, the AI assistant of Neelambari Silks.` }] })),
  setSetting: vi.fn(async () => patched()),
  setFindsOut: vi.fn(async () => patched()),
  addFaq: vi.fn(async (question: string, answer: string) => ({ ok: true as const, data: { id: "new-1", question, answer } })),
  removeFaq: vi.fn(async (id: string) => ({ ok: true as const, data: { id } })),
  test: vi.fn(async (channel) => ({ ok: true as const, data: { channel, sent: false, minutesUsed: 0 } })),
  ...over,
});
const view = (kind = "speed_to_lead", a: JobPageActions | null = acts()) => render(<JobPage detail={detailOf(kind)} words={words} base={BASE} lang="en" ago={{ unit: "min", n: 9 }} actions={a} />);
const part = (name: string) => document.querySelector(`[data-part="${name}"]`) as HTMLElement;

describe("the job page: the parts", () => {
  it("shows the name, what it does, the solid chip, the last run, the switch; When as plain labelled dropdowns (owner, 29 Nov: no sentences), at most four", () => {
    view();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Quick responder");
    expect(within(part("job-header")).getByText(/calls them within minutes/)).toBeInTheDocument();
    expect(part("job-header").querySelector(".jb-chip")).toHaveAttribute("data-tone", "info");
    expect(part("last-run")).toHaveTextContent("Last run 9 min ago");
    expect(screen.getByRole("switch", { name: "Quick responder" })).toHaveAttribute("aria-checked", "true");
    const when = part("job-when");
    expect(within(when).getByRole("combobox", { name: "Call new enquiries" })).toHaveValue("right_away");
    expect(within(when).getByRole("combobox", { name: "Calls start at" })).toHaveValue("09:30");
    expect(within(when).getByRole("combobox", { name: "Calls stop at" })).toHaveValue("19:00");
    expect(within(when).getByRole("combobox", { name: "If nobody answers, try again" })).toHaveValue("3");
    expect(when.querySelectorAll("select")).toHaveLength(4);
  });
  it("What it will do: the effect line and its three steps follow the chosen settings", async () => {
    view();
    const effect = part("effect");
    expect(effect).toHaveTextContent("Ravi fills your form at 8:15 pm → thank-you WhatsApp at 9 am → call at 9:30 am.");
    expect(effect.querySelectorAll("li")).toHaveLength(3);
    fireEvent.change(within(part("job-when")).getByRole("combobox", { name: "Calls start at" }), { target: { value: "10:30" } });
    expect(effect).toHaveTextContent("thank-you WhatsApp at 10 am → call at 10:30 am");
  });
  it("What it says: the preview has the business name and the AI line; the language choice is there; Change by saying it opens the assistant with a sentence", () => {
    view();
    const says = part("job-says");
    expect(within(says).getByText(/the AI assistant of Neelambari Silks/)).toBeInTheDocument();
    // the language moved to the Who talks card (one place for it); the card is drawn for a job that talks
    expect(within(says).queryByRole("combobox", { name: "Language of the call" })).toBeNull();
    expect(within(part("who-talks")).getAllByRole("combobox")[0]).toHaveValue("te");
    const href = within(says).getByRole("link", { name: "Change by saying it" }).getAttribute("href")!;
    expect(href.startsWith(`${BASE}?say=`)).toBe(true);
    expect(decodeURIComponent(href)).toContain("Quick responder");
  });
  it("What it finds out (round ticks), FAQs, More choices as details, Results with the four solid chips", () => {
    view();
    expect(part("job-finds").querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
    expect(part("job-finds").querySelectorAll("input:checked")).toHaveLength(3);
    expect(part("job-faqs").querySelectorAll("[data-faq]")).toHaveLength(2);
    const more = part("job-more");
    expect(more.tagName).toBe("DETAILS");
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByText("More choices")).toBeInTheDocument();
    const res = part("job-results");
    expect([...res.querySelectorAll("[data-number]")].map((n) => n.textContent)).toEqual(["38enquiries called", "27picked up", "9store visits booked"]);
    expect([...res.querySelectorAll("[data-result] .jb-chip")].map((c) => c.getAttribute("data-tone"))).toEqual(["done", "wait", "info"]);
    expect(res).toHaveTextContent("Visit booked, Saturday, 4 pm");
  });
  it("a job with no customers to talk to (the researcher) has no What it says and no Try it; a job with a name shows it", () => {
    view("researcher");
    expect(part("job-says")).toBeNull();
    expect(part("job-try")).toBeNull();
    cleanup();
    view("store_visits");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Priya");
    expect(part("job-try")).not.toBeNull();
  });
  it("a failed job shows why and its fix; people who may only read cannot change anything", () => {
    view("followups");
    const f = part("job-failure");
    expect(f).toHaveTextContent("Why: WhatsApp only lets us write first");
    expect(within(f).getAllByRole("link", { name: "Send template" })).toHaveLength(2);
    expect(within(f).getByRole("link", { name: "Send template to all 2" })).toHaveAttribute("href", `${BASE}/integrations/whatsapp`);
    cleanup();
    view("speed_to_lead", null);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    for (const sel of document.querySelectorAll("select")) expect(sel).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add a question" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Test call to my phone" })).toBeNull();
    expect(screen.getByText("Only the owner and admins can change this team member.")).toBeInTheDocument();
    cleanup();
    view("followups", null);
    expect(document.querySelector('[data-part="job-failure"] a')).toBeNull();
  });
});

describe("the job page: changing things", () => {
  it("a choice answers at once, is saved once, and is put back with the reason when it was refused", async () => {
    const a = acts();
    view("speed_to_lead", a);
    const sel = within(part("job-when")).getByRole("combobox", { name: "Call new enquiries" });
    fireEvent.change(sel, { target: { value: "after_15" } });
    expect(sel).toHaveValue("after_15");
    await waitFor(() => expect(a.setSetting).toHaveBeenCalledWith("response", "after_15"));
    cleanup();
    const bad = acts({ setSetting: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "You may not do this." })) });
    view("speed_to_lead", bad);
    const s2 = within(part("job-when")).getByRole("combobox", { name: "Call new enquiries" });
    fireEvent.change(s2, { target: { value: "after_5" } });
    expect(await within(part("job-when")).findByRole("alert")).toHaveTextContent("You may not do this.");
    expect(s2).toHaveValue("right_away");
  });
  it("a tick under What it finds out is saved; a toggle under More choices too", async () => {
    const a = acts();
    view("speed_to_lead", a);
    fireEvent.click(within(part("job-finds")).getByRole("checkbox", { name: "Colour or fabric they like" }));
    await waitFor(() => expect(a.setFindsOut).toHaveBeenCalledWith("fabric", true));
    fireEvent.click(within(part("job-more")).getByRole("checkbox", { name: "Tell me on WhatsApp when a store visit is booked" }));
    await waitFor(() => expect(a.setSetting).toHaveBeenCalledWith("notify_visit", false));
  });
  it("FAQs: add by typing (a short one is refused on the spot), remove with the cross", async () => {
    const a = acts();
    view("speed_to_lead", a);
    fireEvent.click(screen.getByRole("button", { name: "Add a question" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Write a question and its answer.");
    expect(a.addFaq).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Do you give discounts?" } });
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "On festival days." } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(a.addFaq).toHaveBeenCalledWith("Do you give discounts?", "On festival days."));
    expect(await screen.findByText("Do you give discounts?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove “Do you open on Sundays?”" }));
    await waitFor(() => expect(a.removeFaq).toHaveBeenCalledWith("faq-speed_to_lead-1"));
    expect(screen.queryByText("Do you open on Sundays?")).toBeNull();
  });
  it("a refused choice (422 setting_invalid) is put back and the setting it names in `fields` is marked", async () => {
    const bad = acts({ setSetting: vi.fn(async () => ({ ok: false as const, kind: "invalid" as const, error: "That choice was not accepted. Pick another one.", code: "setting_invalid", fields: ["from_hour"] })) });
    view("speed_to_lead", bad);
    const from = within(part("job-when")).getByRole("combobox", { name: "Calls start at" });
    fireEvent.change(from, { target: { value: "10:30" } });
    expect(await within(part("job-when")).findByRole("alert")).toHaveTextContent("That choice was not accepted. Pick another one.");
    expect(from).toHaveValue("09:30");
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(within(part("job-when")).getByRole("combobox", { name: "Calls stop at" })).not.toHaveAttribute("aria-invalid");
    expect(within(part("job-when")).getByRole("combobox", { name: "Call new enquiries" })).not.toHaveAttribute("aria-invalid");
  });
  it("FAQs: a refused answer (422 faq_not_allowed) is said inline and the form stays open; question and answer stop at 300 characters", async () => {
    const a = acts({ addFaq: vi.fn(async () => ({ ok: false as const, kind: "invalid" as const, error: "A team member's answer may not promise a price or a discount.", code: "faq_not_allowed" })) });
    view("speed_to_lead", a);
    fireEvent.click(screen.getByRole("button", { name: "Add a question" }));
    expect(screen.getByLabelText("Question")).toHaveAttribute("maxlength", "300");
    expect(screen.getByLabelText("Answer")).toHaveAttribute("maxlength", "300");
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Do you give discounts?" } });
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Yes, 20 percent off." } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await within(part("job-faqs")).findByRole("alert")).toHaveTextContent("A team member's answer may not promise a price or a discount.");
    expect(screen.getByLabelText("Question")).toHaveValue("Do you give discounts?");
  });
  it("Test call: the answer is a plain sentence; in test mode it says nothing was called", async () => {
    const a = acts();
    view("speed_to_lead", a);
    fireEvent.click(screen.getByRole("button", { name: "Test call to my phone" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Test mode: nothing was called or sent.");
    expect(a.test).toHaveBeenCalledWith("call");
    cleanup();
    view("followups", a);
    expect(screen.getByRole("button", { name: "Test message to my phone" })).toBeInTheDocument();
  });
  it("a test call IS a real call to the owner's own phone: the card says it uses about 1 free minute before the button, and after the call how many it used; a message says nothing of minutes", async () => {
    const a = acts({ test: vi.fn(async (channel) => ({ ok: true as const, data: { channel, sent: true, minutesUsed: channel === "call" ? 1 : 0 } })) });
    view("speed_to_lead", a);
    expect(part("job-try")).toHaveTextContent("This calls YOUR phone and uses about 1 of your free minutes. Nothing is sent to customers.");
    fireEvent.click(screen.getByRole("button", { name: "Test call to my phone" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Calling your phone now. Pick up to hear it. That test used 1 of your free minutes.");
    cleanup();
    view("followups", a);
    expect(part("job-try")).not.toHaveTextContent("free minutes");
    fireEvent.click(screen.getByRole("button", { name: "Test message to my phone" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sent to your own phone.");
    expect(screen.getByRole("status")).not.toHaveTextContent("free minutes");
    expect(a.test).toHaveBeenLastCalledWith("whatsapp");
  });
  it("outside 10 am to 9 pm the test is refused (409 quiet_hours): the button goes off and the sentence says when tests are sent", async () => {
    const a = acts({ test: vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, error: "x", code: "quiet_hours" })) });
    view("speed_to_lead", a);
    fireEvent.click(screen.getByRole("button", { name: "Test call to my phone" }));
    expect(await within(part("job-try")).findByRole("alert")).toHaveTextContent("Test calls and messages are only sent between 10 am and 9 pm.");
    expect(screen.getByRole("button", { name: "Test call to my phone" })).toBeDisabled();
    expect(a.test).toHaveBeenCalledTimes(1);
  });
});

describe("the job page: a job the plan or the setup blocks", () => {
  it("shows a short note under the name: a phone number, WhatsApp, free minutes or billing", () => {
    const detail = detailOf("speed_to_lead");
    for (const [code, text] of [["no_whatsapp", "Connect WhatsApp first"], ["no_number", "Needs a phone number first"], ["minutes_used", "Free minutes used"], ["billing_blocked", "Billing needs a look"]] as const) {
      render(<JobPage detail={{ ...detail, job: { ...detail.job, planGate: code } }} words={words} base={BASE} lang="en" ago={null} actions={acts()} />);
      expect(part("job-header").querySelector("[data-part='job-gate']")).toHaveTextContent(text);
      cleanup();
    }
    view("speed_to_lead");
    expect(part("job-header").querySelector("[data-part='job-gate']")).toBeNull();
  });
  it("Results hide a number the web has no words for, and show the researcher's free searches without the date or the flag", () => {
    view("researcher");
    const res = part("job-results");
    expect([...res.querySelectorAll("[data-number]")].map((n) => n.textContent)).toEqual(["12shops found", "3contacted by you", "1free searches a month", "1free searches left"]);
  });
});

describe("the job page: renaming and the switch, with Undo", () => {
  it("tap the name: the box opens, 'Customers hear' follows what is typed, Save renames, the toast offers Undo", async () => {
    const a = acts();
    view("speed_to_lead", a);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const form = part("rename");
    expect(within(form).getByText("Customers hear: “the assistant of Neelambari Silks”")).toBeInTheDocument();
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Priya" } });
    expect(within(form).getByText("Customers hear: “Priya from Neelambari Silks”")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.rename).toHaveBeenCalledWith("Priya"));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Priya");
    expect(part("job-says")).toHaveTextContent("This is Priya, the AI assistant of Neelambari Silks.");
    expect(part("toast")).toHaveTextContent("Renamed to Priya");
    fireEvent.click(within(part("toast")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(a.rename).toHaveBeenLastCalledWith(""));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Quick responder");
    expect(part("toast")).toBeNull();
  });
  it("Use the plain name clears the name; a name that is not allowed is not sent", async () => {
    const a = acts();
    view("store_visits", a);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(within(part("rename")).getByRole("textbox"), { target: { value: "Priya <b>" } });
    fireEvent.click(within(part("rename")).getByRole("button", { name: "Save" }));
    expect(within(part("rename")).getByRole("alert")).toHaveTextContent("Use letters and numbers only.");
    expect(a.rename).not.toHaveBeenCalled();
    fireEvent.click(within(part("rename")).getByRole("button", { name: "Use the plain name" }));
    await waitFor(() => expect(a.rename).toHaveBeenCalledWith(""));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Visit booker");
    expect(part("toast")).toHaveTextContent("Back to the plain name");
  });
  it("the name box stops at 40 characters", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(within(part("rename")).getByRole("textbox")).toHaveAttribute("maxlength", "40");
  });
  it("the switch answers at once, shows Undo, and Undo puts it back; a refusal puts the switch back and says why", async () => {
    const a = acts();
    view("speed_to_lead", a);
    const sw = screen.getByRole("switch");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(a.setEnabled).toHaveBeenCalledWith(false));
    expect(await screen.findByText("Switched off")).toBeInTheDocument();
    expect(part("job-header").querySelector(".jb-chip")).toHaveTextContent("Paused");
    fireEvent.click(within(part("toast")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(a.setEnabled).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
    cleanup();
    view("speed_to_lead", acts({ setEnabled: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "You may not do this." })) }));
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You may not do this.");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
  it("the toast goes by itself after a few seconds", async () => {
    vi.useFakeTimers();
    view();
    fireEvent.click(screen.getByRole("switch"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(part("toast")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(8100);
    });
    expect(part("toast")).toBeNull();
  });
});
