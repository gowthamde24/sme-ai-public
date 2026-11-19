import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }) }));

import { appDict } from "@/i18n/app";
import { defaultCallSettings, type CallSettings } from "@/lib/call-settings/types";
import { DEFAULT_RULE_HOURS, retryTimes, ruleEffect } from "@/lib/jobs/rules-effect";
import { MOCK_POLICY, MOCK_TEMPLATES, newRule, ruleOf } from "@/lib/outreach/mock";
import type { Done, Rule } from "@/lib/outreach/types";
import { goalNames, languageNames, sourceNames } from "@/lib/outreach/words";

import { CallSettingsAdvanced } from "../../assistant/CallSettingsAdvanced";
import { RulesPanel } from "../../outreach/RulesPanel";
import { PolicySentences } from "./PolicySentences";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(ol|pc|ld|jobs\.rules|calls|asst|today\.(lang|err))\./.test(k)));
const t0 = new Date("2026-10-27T10:00:00.000Z");
beforeEach(() => {
  refresh.mockReset();
});
/** A sentence as the person reads it: each choice shows the option it has chosen (a select's own text is all of its options). */
const said = (el: Element | null): string => {
  const clone = el!.cloneNode(true) as HTMLElement;
  const live = Array.from(el!.querySelectorAll("select"));
  clone.querySelectorAll("select").forEach((sel, i) => sel.replaceWith(document.createTextNode(live[i].selectedOptions[0]?.textContent ?? "")));
  clone.querySelectorAll("svg").forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
};
afterEach(cleanup);

describe("standing rules as sentences (JOBS)", () => {
  const rule: Rule = ruleOf(newRule({ ruleId: "66666666-6666-4666-8666-666666666666", source: "meta_lead_ads", action: "call_within_minutes", withinMinutes: 0, goal: "general", channel: "call", language: "en", questions: [], waFirstTemplate: null, waMissedTemplate: null, maxCallsPerDay: 50, maxTotalMinutes: null }, t0), t0);
  const draw = (over: Partial<Parameters<typeof RulesPanel>[0]> = {}, save = vi.fn<(input: unknown) => Promise<Done<Rule>>>(async () => ({ ok: true, value: rule })), control = vi.fn(async (): Promise<Done<Rule>> => ({ ok: true, value: rule }))) => {
    render(<RulesPanel simple hours={{ fromMinute: 570, toMinute: 1140, nightCallMinute: 570 }} words={words} rules={[rule]} canAdd canControl sourceNames={sourceNames(words)} goalNames={goalNames(words)} languageNames={languageNames()} actions={{ save, control }} securityHref="/app/security" defaultLanguage="en" templates={MOCK_TEMPLATES} retrySteps={MOCK_POLICY.retrySteps} {...over} />);
    return { save, control };
  };

  it("reads a rule as ONE sentence with the choice inside, a switch, and what it did", () => {
    draw();
    const card = document.querySelector("[data-rule='meta_lead_ads']") as HTMLElement;
    expect(card.querySelector("[data-setting-line='rule']")).toHaveTextContent("When a lead comes from Meta lead ads, call right away.");
    expect(within(card).getByRole("switch", { name: "Pause this rule" })).toHaveAttribute("aria-checked", "true");
    expect(card).toHaveTextContent("leads handled");
    expect(card.querySelector('[data-part="rule-plan"]')).toHaveTextContent("call again after 10 minutes, then after 2 hours, then next morning at 09:30");
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("the switch answers at once and pauses; if the API says no it is put back with the reason", async () => {
    const { control } = draw();
    const sw = screen.getByRole("switch", { name: "Pause this rule" });
    await act(async () => void fireEvent.click(sw));
    expect(control).toHaveBeenCalledWith(rule.id, "pause");
    expect(refresh).toHaveBeenCalled();
    cleanup();
    const failing = vi.fn(async (): Promise<Done<Rule>> => ({ ok: false, error: "down" }));
    draw({}, undefined, failing);
    await act(async () => void fireEvent.click(screen.getByRole("switch", { name: "Pause this rule" })));
    expect(screen.getByRole("switch", { name: "Pause this rule" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("a paused rule shows a solid Paused chip and offers Turn on; the others only read", () => {
    draw({ rules: [{ ...rule, active: false, pausedReason: "cap_calls" }] });
    expect(screen.getByRole("switch", { name: "Turn this rule on again" })).toHaveAttribute("aria-checked", "false");
    expect(document.querySelector(".jb-chip[data-tone='wait']")).toBeInTheDocument();
    cleanup();
    draw({ canControl: false, canAdd: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows at most four choices at first and the rare ones under More choices on the same page", () => {
    draw({ rules: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    const form = document.querySelector("[data-part=rule-form]") as HTMLElement;
    const more = form.querySelector("[data-part=more-choices]") as HTMLElement;
    const visible = Array.from(form.querySelectorAll("select, input[type=checkbox], input[type=number], textarea")).filter((el) => !more.contains(el));
    expect(visible.length).toBeLessThanOrEqual(4);
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByLabelText(/Speak in/)).toBeInTheDocument();
    expect(within(more).getByLabelText(/At most …? calls a day|At most … calls a day\./)).toBeInTheDocument();
    expect(form.querySelector("[data-part=effect]")).toHaveTextContent("What it will do: Ravi's form at 8:15 pm → call at 9:30 am.");
  });

  it("the effect line follows the choices: with a WhatsApp it is thank-you WhatsApp 30 minutes before the morning call", () => {
    draw({ rules: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    fireEvent.click(screen.getByLabelText("Also send a WhatsApp message when they ask for it on the call"));
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("What it will do: Ravi's form at 8:15 pm → thank-you WhatsApp at 9 am → call at 9:30 am.");
    expect(screen.getByLabelText(/First WhatsApp/)).toHaveValue("lead_ack");
    expect(screen.getByLabelText(/If nobody answers, send/)).toHaveValue("missed_call_followup");
  });

  it("offers only the goals of the business type, and keeps the goal a rule being changed already has", () => {
    draw({ rules: [], goals: ["site_visit", "qualify", "callback", "general"] });
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    const goal = screen.getByLabelText(/The call is for/) as HTMLSelectElement;
    expect(Array.from(goal.options).map((o) => o.value)).toEqual(["site_visit", "qualify", "callback", "general"]);
    cleanup();
    draw({ rules: [{ ...rule, goal: "test_drive" }], goals: ["site_visit", "qualify", "callback", "general"] });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(Array.from((screen.getByLabelText(/The call is for/) as HTMLSelectElement).options).map((o) => o.value)).toContain("test_drive");
  });

  it("approves a new rule ONCE and sends the same closed values as the old form", async () => {
    const { save } = draw({ rules: [] });
    expect(screen.getByText(/No standing rules yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a standing rule" }));
    fireEvent.change(screen.getByLabelText(/When a lead comes from … , call …\. ?\(2\)|When a lead comes from … ?, call … ?\. ?\(2\)/), { target: { value: "5" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "indiamart" } });
    expect(document.querySelector("[data-part=rule-sentence] [data-setting-line=when]")).toHaveTextContent(/When a lead comes from.*IndiaMART.*call.*within 5 minutes/);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ source: "indiamart", action: "call_within_minutes", withinMinutes: 5, channel: "call", language: "auto", maxCallsPerDay: 50, maxTotalMinutes: null, waFirstTemplate: null, waMissedTemplate: null });
    expect(screen.getByRole("status")).toHaveTextContent("Rule approved");
  });

  it("an approval without the second step says so and links to setting it up; a changed rule keeps its id and source and a value outside the short list", async () => {
    const mfa = vi.fn(async (): Promise<Done<Rule>> => ({ ok: false, error: "mfa" }));
    const { save } = draw({ rules: [{ ...rule, withinMinutes: 7 }] }, mfa);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const within7 = screen.getByLabelText(/When a lead comes from.*\(2\)/) as HTMLSelectElement;
    expect(within7.value).toBe("7");
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).disabled).toBe(true);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve this rule" })));
    expect(save.mock.calls[0][0]).toMatchObject({ ruleId: rule.id, source: "meta_lead_ads", withinMinutes: 7 });
    expect(screen.getByRole("alert")).toHaveTextContent("second sign-in step");
    expect(screen.getByRole("link", { name: "Set it up" })).toBeInTheDocument();
  });

  it("with JOBS off (no simple) the panel is drawn exactly as before", () => {
    draw({ simple: false });
    expect(document.querySelector("[data-simple]")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause this rule" })).toBeInTheDocument();
  });
});

describe("calling hours and tries as sentences", () => {
  it("reads the hours and the tries as sentences with the values inside, and keeps the link to change them", () => {
    render(<PolicySentences words={words} policy={{ ...MOCK_POLICY, retrySteps: null }} changeHref="/app/tenants/t/settings?section=assistant" />);
    const part = document.querySelector("[data-part=policy]") as HTMLElement;
    expect(part.querySelector("[data-setting-line=hours]")).toHaveTextContent("Call between 9 am and 7 pm, Mon, Tue, Wed, Thu, Fri, Sat.");
    expect(part.querySelector("[data-setting-line=tries]")).toHaveTextContent("If nobody answers, try 3 times, 18 hours apart.");
    expect(part).toHaveTextContent("called the next morning at 9:30 am");
    expect(part).toHaveTextContent("reminded after 15 minutes");
    expect(part).toHaveTextContent("never contacted again");
    expect(screen.getByRole("link", { name: "Change the calling hours" })).toHaveAttribute("href", "/app/tenants/t/settings?section=assistant");
  });
  it("with the retry steps it names them", () => {
    render(<PolicySentences words={words} policy={MOCK_POLICY} changeHref="/x" />);
    expect(said(document.querySelector("[data-setting-line=tries]"))).toContain("call again after 10 minutes, then after 2 hours, then next morning at 09:30");
  });
});

describe("call settings as sentences (JOBS)", () => {
  const save = vi.fn(async (input: unknown) => (void input, { ok: true }) as { ok: true } | { ok: false; error: string });
  const draw = (over: Partial<{ initial: CallSettings; canEdit: boolean }> = {}) =>
    render(<CallSettingsAdvanced simple words={words} initial={over.initial ?? defaultCallSettings(null)} locked={null} canEdit={over.canEdit ?? true} mock={false} saved={false} actions={{ save }} />);
  beforeEach(() => save.mockClear());

  it("shows four things as sentences, what it will do, and everything else under More choices", () => {
    draw();
    const main = document.querySelector("[data-part=cs-main]") as HTMLElement;
    expect(said(main.querySelector("[data-setting-line=retry_no_answer]"))).toBe("If nobody answers, call again 3 more times, 2 hours apart.");
    expect(said(main.querySelector("[data-setting-line=week]"))).toBe("Call one customer at most 2 times a week.");
    expect(within(main).getByLabelText("Same hours as your assistant")).toBeChecked();
    expect(within(main).getByLabelText("Never pause by itself")).not.toBeChecked();
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent(/What it will do: Ravi does not answer at 10 am → it calls again at 12 pm, 2 pm, 4 pm\./);
    const more = document.querySelector("[data-part=more-choices]") as HTMLElement;
    expect(more).not.toHaveAttribute("open");
    for (const g of ["Trying again", "On the line", "Names and words", "Hand-over by topic", "Memory and what it may call about"]) expect(within(more).getByText(g)).toBeInTheDocument();
    expect(more.querySelector("[data-setting-line=retry_busy]")).toBeInTheDocument();
    expect(more.querySelector("[data-setting-line=retry_call_later]")).toBeInTheDocument();
    expect(more.querySelector("[data-setting-line=concurrent]")).toBeInTheDocument();
  });

  it("saves the same whole value as the old form after a few changes", async () => {
    draw();
    const noans = document.querySelectorAll("[data-part=cs-main] [data-setting-line=retry_no_answer] select");
    fireEvent.change(noans[0], { target: { value: "4" } });
    fireEvent.change(noans[1], { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText(/Call one customer at most/), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("Same hours as your assistant"));
    const from = screen.getByLabelText(/From: Call between/) as HTMLSelectElement;
    fireEvent.change(from, { target: { value: "615" } });
    fireEvent.click(screen.getByLabelText("Never pause by itself"));
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    await act(async () => void 0);
    fireEvent.change(screen.getByLabelText("Written"), { target: { value: "Kanchipuram" } });
    fireEvent.change(screen.getByLabelText("Said as"), { target: { value: "Kanchi-puram" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save call settings" })));
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0][0] as CallSettings;
    expect(sent.retry_no_answer).toEqual({ count: 4, gap_minutes: 60 });
    expect(sent.max_calls_per_customer_per_week).toBe(5);
    expect(sent.hours).toMatchObject({ from_minute: 615, to_minute: 1140, days: [1, 2, 3, 4, 5, 6] });
    expect(sent.auto_pause_refusals_per_hour).toBeNull();
    expect(sent.pronunciations).toEqual([{ written: "Kanchipuram", spoken: "Kanchi-puram" }]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(refresh).toHaveBeenCalled();
  });

  it("a saved value outside the short lists still shows and is kept (a 35 minute gap)", async () => {
    const initial = { ...defaultCallSettings(null), retry_no_answer: { count: 2, gap_minutes: 35 } };
    draw({ initial });
    const gap = document.querySelectorAll("[data-setting-line=retry_no_answer] select")[1] as HTMLSelectElement;
    expect(gap.value).toBe("35");
    expect(gap.selectedOptions[0]).toHaveTextContent("35 minutes");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save call settings" })));
    expect((save.mock.calls[0][0] as CallSettings).retry_no_answer).toEqual({ count: 2, gap_minutes: 35 });
  });

  it("an Admin only reads (nothing can be changed or saved)", () => {
    draw({ canEdit: false });
    expect(screen.getByRole("button", { name: "Save call settings" })).toBeDisabled();
    expect(document.querySelector("[data-setting-line=week] select")).toBeDisabled();
  });

  it("without simple the old form is drawn", () => {
    render(<CallSettingsAdvanced words={words} initial={defaultCallSettings(null)} locked={null} canEdit mock={false} saved={false} actions={{ save }} />);
    expect(document.querySelector("[data-simple]")).toBeNull();
    expect(screen.getAllByLabelText("Tries (0 = never again)")).toHaveLength(3);
  });
});

describe("the worked examples", () => {
  it("a lead after hours is called the next morning with the thank-you half an hour before; inside the hours the call follows the minutes", () => {
    expect(ruleEffect(0, true, { fromMinute: 570, toMinute: 1140, nightCallMinute: 570 })).toMatchObject({ code: "wa_call", wa: 540, call: 570 });
    expect(ruleEffect(2, false, { fromMinute: 570, toMinute: 1260, nightCallMinute: 570 })).toMatchObject({ code: "call", wa: null, call: 20 * 60 + 17 });
    expect(ruleEffect(0, false, null).call).toBe(DEFAULT_RULE_HOURS.nightCallMinute);
  });
  it("tries wait for the next morning when they would fall after the hours", () => {
    expect(retryTimes(3, 120, { fromMinute: 540, toMinute: 1140 })).toEqual([720, 840, 960]);
    expect(retryTimes(3, 240, { fromMinute: 540, toMinute: 1140 })).toEqual([840, 1080, 1440 + 540]);
    expect(retryTimes(0, 60, null)).toEqual([]);
  });
});
