import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }) }));

import { appDict } from "@/i18n/app";
import { defaultCallSettings, purposesFor, type CallSettings } from "@/lib/call-settings/types";

import { CallSettingsAdvanced } from "./CallSettingsAdvanced";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("calls.") || k.startsWith("asst.hours") || k.startsWith("asst.day.") || k.startsWith("today.err.")));
const save = vi.fn(async (input: unknown) => (void input, { ok: true }) as { ok: true } | { ok: false; error: string });
const draw = (over: Partial<{ initial: CallSettings; locked: ReturnType<typeof purposesFor>; canEdit: boolean; mock: boolean }> = {}) =>
  render(<CallSettingsAdvanced words={words} initial={over.initial ?? defaultCallSettings(null)} locked={over.locked ?? null} canEdit={over.canEdit ?? true} mock={over.mock ?? false} saved={false} actions={{ save }} />);
const submit = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save call settings" })));

beforeEach(() => {
  save.mockClear();
  refresh.mockReset();
});
afterEach(cleanup);

describe("Settings > AI assistant > Advanced (call settings)", () => {
  it("is a closed part with a plain heading, the groups of the contract and the shop's defaults in it", () => {
    draw();
    const part = document.querySelector("details[data-settings='call-settings']")!;
    expect(part).not.toHaveAttribute("open");
    expect(within(part as HTMLElement).getByText("Advanced: how calls behave")).toBeInTheDocument();
    for (const g of ["Trying again", "On the line", "Names and words", "When it calls", "Safety", "Hand-over by topic", "Memory and what it may call about"]) expect(screen.getByText(g)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Tries (0 = never again)").map((i) => (i as HTMLInputElement).value)).toEqual(["2", "3", "2"]);
    expect(screen.getByLabelText("Calls at the same time (1 to 20)")).toHaveValue(1);
    expect(screen.getByLabelText("Same hours as the AI assistant")).toBeChecked();
    expect(screen.queryByLabelText("From")).toBeNull(); // own hours only when chosen
  });
  it("saves the whole value after a few changes: a retry, a pronunciation, key words, own hours, a holiday, a hand-over person, no automatic pause", async () => {
    draw();
    fireEvent.change(screen.getAllByLabelText("Tries (0 = never again)")[0], { target: { value: "4" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    await act(async () => void 0);
    fireEvent.change(screen.getByLabelText("Written"), { target: { value: "Kanchipuram" } });
    fireEvent.change(screen.getByLabelText("Said as"), { target: { value: "Kanchi-puram" } });
    fireEvent.change(screen.getByLabelText("Words to listen for (one on each line, up to 100)"), { target: { value: "pattu\nborder\n" } });
    fireEvent.click(screen.getByLabelText("Same hours as the AI assistant"));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "10:15" } });
    fireEvent.click(screen.getByLabelText("Never pause by itself"));
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0][0] as CallSettings;
    expect(sent.retry_busy).toEqual({ count: 4, gap_minutes: 30 });
    expect(sent.pronunciations).toEqual([{ written: "Kanchipuram", spoken: "Kanchi-puram" }]);
    expect(sent.keywords).toEqual(["pattu", "border"]);
    expect(sent.hours).toMatchObject({ from_minute: 615, to_minute: 1140, days: [1, 2, 3, 4, 5, 6] });
    expect(sent.auto_pause_refusals_per_hour).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(refresh).toHaveBeenCalled();
  });
  it("a hand-over person: a topic goes to one person; the phone needs + and digits, else Save is off", async () => {
    draw();
    fireEvent.click(screen.getAllByRole("button", { name: "Add" }).at(-1)!);
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "Ravi" } });
    expect(screen.getByLabelText("Phone, with +")).toHaveValue("+91");
    expect(screen.getByRole("button", { name: "Save call settings" })).toBeDisabled(); // +91 alone is not a number
    fireEvent.change(screen.getByLabelText("Phone, with +"), { target: { value: "+91 98765-43210" } });
    expect(screen.getByLabelText("Phone, with +")).toHaveValue("+919876543210");
    expect(screen.getByRole("button", { name: "Save call settings" })).toBeEnabled();
    expect(screen.getByText(/Only the Owner and Admin see these names and numbers/)).toBeInTheDocument();
  });
  it("a school sees the calls it may not make switched off, with the reason, and cannot switch them on", async () => {
    draw({ initial: defaultCallSettings(["programmes"]), locked: purposesFor(["programmes"]) });
    expect(screen.getByLabelText("Sales follow-up")).not.toBeChecked();
    expect(screen.getByLabelText("Payment reminder")).not.toBeChecked();
    expect(screen.getByLabelText("Admission follow-up")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Sales follow-up"));
    expect(screen.getByLabelText("Sales follow-up")).not.toBeChecked();
    expect(screen.getByText("A school makes no sales calls and none about dues or fees.")).toBeInTheDocument();
    await submit();
    expect((save.mock.calls[0][0] as CallSettings).allowed_purposes).toEqual(["admission_followup", "visit_reminder"]);
  });
  it("only the Owner saves: for anyone else every field and Save are off", () => {
    draw({ canEdit: false });
    expect(screen.getByRole("button", { name: "Save call settings" })).toBeDisabled();
    expect(screen.getByLabelText("Calls at the same time (1 to 20)")).toBeDisabled();
  });
  it("a refusal is said in our words: the second factor (with the way to Security), a locked call, a closed plan, anything else", async () => {
    for (const [error, text] of [["mfa", /authenticator app/], ["locked", /A school cannot switch that on/], ["read_only", /read-only/], ["invalid", /That did not save/]] as const) {
      cleanup();
      save.mockResolvedValueOnce({ ok: false, error });
      draw();
      await submit();
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      if (error === "mfa") expect(screen.getByRole("link", { name: /Security|authenticator/i })).toHaveAttribute("href", "/app/security");
    }
  });
  it("test mode says the choices stay on this device", () => {
    draw({ mock: true });
    expect(screen.getByRole("note")).toHaveTextContent("Test mode: these choices are kept on this device only.");
  });
});
