import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { visit } from "@/lib/api/visits-fixtures";

const h = vi.hoisted(() => ({ visits: vi.fn(), summary: vi.fn(), messages: vi.fn(), items: vi.fn(), week: vi.fn() }));
vi.mock("@/lib/api/visits", async (orig) => ({ ...(await orig<typeof import("@/lib/api/visits")>()), listVisits: (...a: unknown[]) => h.visits(...a), getAiUsageWeek: (...a: unknown[]) => h.week(...a) }));
vi.mock("@/lib/api/outbox", async (orig) => ({ ...(await orig<typeof import("@/lib/api/outbox")>()), getOutboxSummary: (...a: unknown[]) => h.summary(...a), listOutboxMessages: (...a: unknown[]) => h.messages(...a) }));
vi.mock("@/lib/api/catalogue", async (orig) => ({ ...(await orig<typeof import("@/lib/api/catalogue")>()), listCatalogueItems: (...a: unknown[]) => h.items(...a) }));

import { readReport } from "./report-data";

const T = "22222222-2222-2222-2222-222222222222";
// Wednesday 14 October 2026, 10:00 in India
const NOW = Date.parse("2026-10-14T04:30:00Z");
const sent = (over: Record<string, unknown> = {}) => ({ id: "m", reason: "owner_approved", created_at: "2026-10-13T04:00:00Z", decided_at: "2026-10-13T04:30:00Z", media: [], ...over });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.visits.mockResolvedValue({ from: "2026-10-12", to: "2026-10-18", items: [visit({ status: "completed", outcome: "bought", date: "2026-10-13" })] });
  h.summary.mockResolvedValue({ waiting: 2, scheduled: 1, sent: 9, blocked: 3, due_now: 0, held_for_later: 1 });
  h.messages.mockResolvedValue({ items: [sent()], next_cursor: null });
  h.items.mockResolvedValue({ items: [], next_cursor: null });
  h.week.mockResolvedValue({ week_percent: 42, resets_at_week: "2026-10-19" });
});

describe("readReport", () => {
  it("reads the India week with the person's token and puts the figures together", async () => {
    const r = await readReport("tok", T, NOW);
    expect(r.range).toEqual({ from: "2026-10-12", to: "2026-10-18", today: "2026-10-14" });
    expect(h.visits).toHaveBeenCalledWith("tok", T, { from: "2026-10-12", to: "2026-10-18" });
    expect(h.summary).toHaveBeenCalledWith("tok", T, { from: "2026-10-12", to: "2026-10-18" });
    expect(h.messages).toHaveBeenCalledWith("tok", T, expect.objectContaining({ tab: "sent", from: "2026-10-12", to: "2026-10-18", limit: 100 }));
    expect(r.visits).toMatchObject({ booked: 1, arrived: 1, bought: 1 });
    expect(r.messages).toEqual({ sent: 9, waiting: 2, blocked: 3 });
    expect(r.approval).toEqual({ medianMinutes: 30, count: 1 });
    expect(r.aiPercent).toBe(42);
  });
  it("does not read the catalogue when no sent message carried a photo", async () => {
    const r = await readReport("tok", T, NOW);
    expect(h.items).not.toHaveBeenCalled();
    expect(r.sarees).toEqual({ top: [], unmatched: 0, withPhotos: 0, capped: false });
  });
  it("matches photos to sarees by their cover and counts them", async () => {
    h.messages.mockResolvedValue({ items: [sent({ media: [{ photo_id: "p1", position: 0, thumb_url: null }] }), sent({ media: [{ photo_id: "p1", position: 0, thumb_url: null }] })], next_cursor: null });
    h.items.mockResolvedValue({ items: [{ id: "i1", name: "Kanchi Red", cover: { id: "p1" } }], next_cursor: null });
    const r = await readReport("tok", T, NOW);
    expect(r.sarees).toMatchObject({ top: [{ id: "i1", name: "Kanchi Red", count: 2 }] });
  });
  it("reads at most three pages of sent messages and says the rest was not counted", async () => {
    h.messages.mockResolvedValue({ items: [sent()], next_cursor: "more" });
    const r = await readReport("tok", T, NOW);
    expect(h.messages).toHaveBeenCalledTimes(3);
    expect(h.messages).toHaveBeenLastCalledWith("tok", T, expect.objectContaining({ after: "more" }));
    expect(r.sarees).toMatchObject({ capped: true });
  });
  it("a part that cannot be read is 'error' alone; the others still show", async () => {
    h.visits.mockRejectedValue(new ApiRequestError(500, "x", "x"));
    h.week.mockRejectedValue(new Error("down"));
    const r = await readReport("tok", T, NOW);
    expect(r.visits).toBe("error");
    expect(r.aiPercent).toBe("error");
    expect(r.messages).toEqual({ sent: 9, waiting: 2, blocked: 3 });
  });
  it("sent messages that cannot be read take down the approval time and the sarees only", async () => {
    h.messages.mockRejectedValue(new Error("down"));
    const r = await readReport("tok", T, NOW);
    expect(r.approval).toBe("error");
    expect(r.sarees).toBe("error");
    expect(r.visits).not.toBe("error");
  });
  it("a catalogue that cannot be read takes down the sarees only", async () => {
    h.messages.mockResolvedValue({ items: [sent({ media: [{ photo_id: "p1", position: 0, thumb_url: null }] })], next_cursor: null });
    h.items.mockRejectedValue(new Error("down"));
    const r = await readReport("tok", T, NOW);
    expect(r.sarees).toBe("error");
    expect(r.approval).toEqual({ medianMinutes: 30, count: 1 });
  });
  it("a rejected session is passed on, not hidden as a part that failed", async () => {
    h.week.mockRejectedValue(new ApiAuthError());
    await expect(readReport("tok", T, NOW)).rejects.toBeInstanceOf(ApiAuthError);
  });
  it("copies no words of any message", async () => {
    h.messages.mockResolvedValue({ items: [sent({ text: "PRIVATE WORDS", customer: "Secret Customer" })], next_cursor: null });
    expect(JSON.stringify(await readReport("tok", T, NOW))).not.toMatch(/PRIVATE|Secret/);
  });
});
