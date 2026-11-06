import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseStandup } from "@/lib/api/ai-team";
import { standupFixture } from "@/lib/api/ai-team-fixtures";

import { StandupCard } from "./StandupCard";

const B = "/app/tenants/11111111-1111-4111-8111-111111111111";
const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("aiteam.")));
const DATE = "2026-11-06";
const en = parseStandup(standupFixture({ date: DATE, language: "en" }));
const play = vi.fn(async () => undefined);

beforeEach(() => {
  play.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(8)], { type: "audio/wav" }) })));
  vi.stubGlobal(
    "Audio",
    class {
      play = play;
      pause = vi.fn();
      onended: (() => void) | null = null;
    },
  );
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the daily stand-up card", () => {
  it("plays the stand-up's sound from this app's route and shows every line with its source", async () => {
    render(<StandupCard base={B} date={DATE} isToday initial={en} words={WORDS} remake={null} />);
    expect(document.querySelectorAll("[data-source]")).toHaveLength(en.lines.length);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Play today's stand-up/ }));
    });
    expect(fetch).toHaveBeenCalledWith(`${B}/ai-team/standup-audio?date=${DATE}`, expect.anything());
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /Pause/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask a follow-up" }).getAttribute("href")).toMatch(/^\/app\/tenants\/[^/]+\/talk\?ask=/);
  });
  it("Kannada wears its draft mark; no sound means the words only", () => {
    render(<StandupCard base={B} date={DATE} isToday initial={{ ...parseStandup(standupFixture({ date: DATE, language: "kn" })), audio: null, audioReason: "limit" }} words={WORDS} remake={null} />);
    expect(document.querySelector('[data-part="draft"]')).toHaveTextContent("draft");
    expect(screen.getByRole("button", { name: /Play/ })).toBeDisabled();
    expect(screen.getByText(/No sound for this one/)).toBeInTheDocument();
  });
  it("Make it again: at most 3 a day; the limit says when the next one comes", async () => {
    const remake = vi.fn(async () => ({ ok: false as const, error: "limit" as const }));
    render(<StandupCard base={B} date={DATE} isToday initial={en} words={WORDS} remake={remake} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Make it again \(3 left today\)/ }));
    });
    expect(remake).toHaveBeenCalledWith(DATE);
    expect(screen.getByRole("alert")).toHaveTextContent(/No more today/);
    cleanup();
    render(<StandupCard base={B} date={DATE} isToday initial={{ ...en, leftToday: 0 }} words={WORDS} remake={remake} />);
    expect(screen.queryByRole("button", { name: /Make it again/ })).toBeNull();
  });
  it("before opening time it says when it comes; Today's compact card has two lines and a link to My AI team", () => {
    render(<StandupCard base={B} date={DATE} isToday initial={null} words={WORDS} remake={vi.fn()} />);
    expect(screen.getByText("Today's stand-up comes at opening time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make it now" })).toBeInTheDocument();
    cleanup();
    render(<StandupCard compact base={B} date={DATE} isToday initial={en} words={WORDS} remake={null} />);
    expect(document.querySelectorAll("[data-source]")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open My AI team" })).toHaveAttribute("href", `${B}/ai-team`);
  });
});
