import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }) }));

import { appDict } from "@/i18n/app";
import { applyOverride } from "@/lib/call-settings/campaign";
import { defaultCallSettings } from "@/lib/call-settings/types";

import { CallSettingsAdvanced } from "./CallSettingsAdvanced";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("calls.") || k.startsWith("asst.hours") || k.startsWith("asst.day.") || k.startsWith("today.err.")));
const base = defaultCallSettings(null);
const save = vi.fn(async (input: unknown) => (void input, { ok: true }) as { ok: true } | { ok: false; error: string });
const clear = vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; error: string });
const draw = (effective = base, canEdit = true, saved = false) =>
  render(<CallSettingsAdvanced words={words} initial={effective} locked={null} canEdit={canEdit} mock={false} saved={saved} actions={{ save }} campaign={{ base, clear, settingsHref: "/app/tenants/t/settings?section=assistant", backHref: "/app/tenants/t/campaigns/c" }} />);
const press = async (name: string) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));

beforeEach(() => {
  save.mockClear();
  clear.mockClear();
  refresh.mockReset();
});
afterEach(cleanup);

describe("call settings of one campaign (job DQ part 3)", () => {
  it("is open, titled for the campaign, and leaves out the holidays and the hand-over people (they are the workspace's)", () => {
    draw();
    const part = document.querySelector("details[data-settings='campaign-call-settings']")!;
    expect(part).toHaveAttribute("open");
    expect(screen.getByText(words["calls.c.title"])).toBeInTheDocument();
    expect(screen.queryByText("Hand-over by topic")).toBeNull();
    expect(screen.queryByText(words["calls.holidays"])).toBeNull();
    expect(screen.getByText(words["calls.c.same"])).toBeInTheDocument();
    expect(document.querySelector("[data-different]")).toBeNull();
  });
  it("marks the group that differs from the workspace and names the fields", () => {
    draw(applyOverride(base, { concurrent_calls: 4 }));
    expect(document.querySelectorAll("[data-different]")).toHaveLength(1);
    expect(screen.getByText("Different here: Calls at once.")).toBeInTheDocument();
  });
  it("saves only what differs from the workspace, so the rest keeps following it", async () => {
    draw();
    fireEvent.change(screen.getByLabelText("Calls at the same time (1 to 20)"), { target: { value: "5" } });
    await press("Save call settings");
    expect(save).toHaveBeenCalledWith({ concurrent_calls: 5 });
  });
  it("'use the assistant's settings' clears the override, puts the workspace's values back and refreshes", async () => {
    draw(applyOverride(base, { concurrent_calls: 4 }), true, true);
    await press(words["calls.c.clear"]);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Calls at the same time (1 to 20)")).toHaveValue(base.concurrent_calls);
    expect(screen.getByRole("status")).toHaveTextContent(words["calls.c.cleared"]);
    expect(refresh).toHaveBeenCalled();
  });
  it("a failed clear says so and keeps the values", async () => {
    clear.mockResolvedValueOnce({ ok: false, error: "mfa" });
    draw(applyOverride(base, { concurrent_calls: 4 }), true, true);
    await press(words["calls.c.clear"]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Calls at the same time (1 to 20)")).toHaveValue(4);
  });
  it("an Admin can read it but not save or clear, and the link to the workspace's settings is there", () => {
    draw(base, false);
    expect(screen.getByRole("button", { name: "Save call settings" })).toBeDisabled();
    expect(screen.getByRole("button", { name: words["calls.c.clear"] })).toBeDisabled();
    expect(screen.getByRole("link", { name: words["calls.c.ws"] })).toHaveAttribute("href", "/app/tenants/t/settings?section=assistant");
  });
});
