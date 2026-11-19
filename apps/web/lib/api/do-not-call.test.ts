import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { MOCK_DNC, MOCK_DNC_COUNT, MOCK_DNC_LIFTED } from "@/lib/jobs/dnc-mock";

import { addDnc, parseDncEntry, parseDncPage, readDnc, removeDnc } from "./do-not-call";

const T = "22222222-2222-4222-8222-222222222222";
const E = "77777777-7777-4777-8777-777777777701";
const wire = { id: E, phone_masked: "+91 98480 ••• 21", reason: "stop_whatsapp", at: "2026-11-12T08:10:00Z", state: "active", added_by: null, history: [] };

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("Do-Not-Call: what the API sends", () => {
  it("reads an entry: a masked number, a closed reason and a date; the whole number is never part of it", () => {
    expect(parseDncEntry(wire)).toEqual({ id: E, phoneMasked: "+91 98480 ••• 21", reason: "stop_whatsapp", at: "2026-11-12T08:10:00Z", state: "active", addedBy: null, history: [] });
    expect(JSON.stringify(parseDncEntry({ ...wire, phone: "+919848012321" }))).not.toContain("919848012321");
  });
  it("reasons are stop_whatsapp, asked_on_call, added_by_owner and other (legal, complained, bounced); the entry carries who added it and, once lifted, its history", () => {
    for (const reason of ["stop_whatsapp", "asked_on_call", "added_by_owner", "other"]) expect(parseDncEntry({ ...wire, reason }).reason).toBe(reason);
    const e = parseDncEntry({ ...wire, reason: "added_by_owner", added_by: "Ramesh", state: "lifted", history: [{ at: "2026-11-20T09:00:00Z", how: "customer_message", by: "customer" }, { at: "2026-11-21T09:00:00Z", how: "owner_recorded_yes", by: "owner_recorded" }, { at: "2026-11-22T09:00:00Z", how: "form_tick" }] });
    expect(e.addedBy).toBe("Ramesh");
    expect(e.state).toBe("lifted");
    // `how` is the closed list; who did it is in the word, so `by` is not read
    expect(e.history).toEqual([{ at: "2026-11-20T09:00:00Z", how: "customer_message" }, { at: "2026-11-21T09:00:00Z", how: "owner_recorded_yes" }, { at: "2026-11-22T09:00:00Z", how: "form_tick" }]);
    expect(parseDncEntry({ ...wire, added_by: "  " }).addedBy).toBeNull();
    expect(parseDncEntry({ id: E, phone_masked: wire.phone_masked, reason: "other", at: wire.at }).history).toEqual([]);
    expect(() => parseDncEntry({ ...wire, history: [{ at: "2026-11-20T09:00:00Z", how: "new_message", by: "customer" }] })).toThrow();
    expect(() => parseDncEntry({ ...wire, history: [{ at: "later", how: "form_tick" }] })).toThrow();
    expect(() => parseDncEntry({ ...wire, state: "gone" })).toThrow();
    // an entry with no `state` is on the list
    expect(parseDncEntry({ id: E, phone_masked: wire.phone_masked, reason: "other", at: wire.at }).state).toBe("active");
  });
  it("refuses a reason it does not know, a number that is not masked-looking and a bad date", () => {
    expect(() => parseDncEntry({ ...wire, reason: "because" })).toThrow();
    expect(() => parseDncEntry({ ...wire, phone_masked: "<script>" })).toThrow();
    expect(() => parseDncEntry({ ...wire, phone_masked: null })).toThrow();
    expect(() => parseDncEntry({ ...wire, at: "yesterday" })).toThrow();
  });
  it("reads a page with its count and cursor; the count falls back to the rows when the API gives none", () => {
    expect(parseDncPage({ items: [wire], count: 128, next_cursor: "c1" })).toEqual({ items: [parseDncEntry(wire)], count: 128, nextCursor: "c1" });
    expect(parseDncPage({ items: [wire] })).toMatchObject({ count: 1, nextCursor: null });
    expect(() => parseDncPage({ items: "no" })).toThrow();
  });
});

describe("Do-Not-Call: the calls", () => {
  it("with JOBS off nothing is read", async () => {
    h.mode.v = "off";
    expect(await readDnc("tok", T)).toBeNull();
    expect(h.req).not.toHaveBeenCalled();
  });
  it("with JOBS=mock the made-up list answers with its count, a search by digits narrows it, and nothing leaves the server", async () => {
    expect(await readDnc("tok", T)).toEqual({ items: [...MOCK_DNC], count: MOCK_DNC_COUNT, nextCursor: null });
    const found = await readDnc("tok", T, { q: "98480" });
    expect(found?.items.map((e) => e.phoneMasked)).toEqual(["+91 98480 ••• 21"]);
    expect((await readDnc("tok", T, { q: "zzz" }))?.items).toEqual([]);
    expect(h.req).not.toHaveBeenCalled();
  });
  it("lifted numbers: `include=lifted` asks for the ones that came off the list (live), and the mock adds them with their history; without it they are not there", async () => {
    expect((await readDnc("tok", T, { includeLifted: true }))?.items).toEqual([...MOCK_DNC, ...MOCK_DNC_LIFTED]);
    expect(MOCK_DNC_LIFTED.every((e) => e.state === "lifted" && e.history.length > 0)).toBe(true);
    expect((await readDnc("tok", T))?.items.some((e) => e.state === "lifted")).toBe(false);
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ items: [{ ...wire, state: "lifted", history: [{ at: "2026-11-20T09:00:00Z", how: "form_tick" }] }], count: 1, next_cursor: null });
    const page = await readDnc("tok", T, { q: "9848", includeLifted: true });
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/do-not-call?q=9848&include=lifted`, "tok");
    expect(page?.items[0]).toMatchObject({ state: "lifted", history: [{ how: "form_tick" }] });
  });
  it("live: GET with the search and the cursor, and a failure is null (the page says it is not available)", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ items: [wire], count: 1, next_cursor: null });
    expect((await readDnc("tok", T, { q: " 9848 ", cursor: "c1" }))?.count).toBe(1);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/do-not-call?q=9848&cursor=c1`, "tok");
    h.req.mockRejectedValueOnce(new Error("down"));
    expect(await readDnc("tok", T)).toBeNull();
  });
  it("add: sends +91 and ten digits only, answers masked; a number that is not an Indian mobile is never sent", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({ ...wire, reason: "added_by_owner" });
    const e = await addDnc("tok", T, "98480 12321");
    expect(e.reason).toBe("added_by_owner");
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/do-not-call`, "tok", { method: "POST", body: JSON.stringify({ phone: "+919848012321" }) });
    await expect(addDnc("tok", T, "12345")).rejects.toThrow();
    expect(h.req).toHaveBeenCalledTimes(1);
  });
  it("add in the mock answers with the masked number and sends nothing", async () => {
    const e = await addDnc("tok", T, "90000 12364");
    expect(e).toMatchObject({ phoneMasked: "+91 90000 ••• 64", reason: "added_by_owner" });
    expect(h.req).not.toHaveBeenCalled();
  });
  it("remove: a POST to /{id}/remove (the project has no DELETE route); a bad id is never sent", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValueOnce(null);
    await removeDnc("tok", T, E);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/do-not-call/${E}/remove`, "tok", { method: "POST", body: JSON.stringify({}) });
    await expect(removeDnc("tok", T, "../x")).rejects.toThrow();
    h.mode.v = "mock";
    await removeDnc("tok", T, E);
    expect(h.req).toHaveBeenCalledTimes(1);
  });
});
