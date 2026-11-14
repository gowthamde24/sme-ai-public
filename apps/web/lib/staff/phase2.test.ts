import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

import type { MockJar } from "./mock-state";
import { parseMockState } from "./mock-state";
import { GOODWILL_MAX_RUPEES, newCreditKey, parseRupees, wordsProblem } from "./reasons";
import { makeSource } from "./source";
import { EMPTY_MOCK, type MockState, businessesJson, threadJson, ticketId, ticketsJson, unmaskedJson } from "./staff-fixtures";
import { parseBusinessList, parseGoodwill, parseThread, parseTicketList, parseUnmasked } from "./types";

const NOW = new Date("2026-11-14T06:00:00Z");
const BIZ = "00000000-0000-4000-8000-000000000003"; // Lakshmi Textiles (sample)
const memoryJar = (): MockJar & { state: MockState } => {
  const jar = {
    state: EMPTY_MOCK as MockState,
    read: async () => jar.state,
    write: async (s: MockState) => {
      jar.state = s;
      return true;
    },
  };
  return jar;
};
const src = (role: "owner" | "support" | "finance" = "owner", jar = memoryJar()) => ({ jar, source: makeSource("mock", "t", role, () => NOW, jar) });
const failure = async <T>(p: Promise<{ ok: boolean; failure?: string; data?: T }>) => {
  const r = await p;
  expect(r.ok).toBe(false);
  return r.failure;
};

describe("the readers of the Phase 2 answers", () => {
  it("a ticket list and a thread read through the same readers the API goes through", () => {
    const list = parseTicketList(ticketsJson("active", NOW));
    expect(list.items).toHaveLength(5);
    expect(list.items[0]).toMatchObject({ id: ticketId(0), priority: "urgent", status: "open" });
    const thread = parseThread(threadJson(ticketId(0), NOW));
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ kind: "note", delivered: false });
    expect(() => parseThread({ ...(threadJson(ticketId(0), NOW) as object), messages: [{ id: "m", kind: "shout", body: "x" }] })).toThrow();
    expect(() => parseThread({ messages: [] })).toThrow();
  });
  it("the businesses list, the credit answer and the unmasked look", () => {
    expect(parseBusinessList(businessesJson("", NOW)).items).toHaveLength(6);
    expect(parseBusinessList(businessesJson("lakshmi", NOW)).items.map((b) => b.name)).toEqual(["Sri Lakshmi Silks", "Lakshmi Textiles"]);
    expect(parseGoodwill({ credited_text: "₹500", balance_text: "₹2,050", replayed: true })).toEqual({ creditedText: "₹500", balanceText: "₹2,050", replayed: true });
    expect(parseUnmasked(unmaskedJson()).calls[0]).toMatchObject({ id: "c1", customer: "Padmaja Naidu" });
    expect(() => parseUnmasked({ recent_calls: "x", recent_chats: [] })).toThrow();
  });
  it("the cookie of the sample is read back safely: anything odd is dropped, never trusted", () => {
    expect(parseMockState("no")).toBeNull();
    const ok = parseMockState({ tickets: { "0": { status: "closed", assignee: "me", msgs: [{ k: "r", b: "hi", t: 1 }] }, "9": { status: "open" }, "1": { status: "bogus" } }, paused: ["a", 3], credited: { a: 100, b: -1 }, fresh: 5 });
    expect(ok).toEqual({ tickets: { "0": { status: "closed", assignee: "me", msgs: [{ k: "r", b: "hi", t: 1 }] }, "1": {} }, paused: ["a"], credited: { a: 100 }, fresh: 5 });
  });
});

describe("money and reasons, typed by a person", () => {
  it("rupees: whole numbers from 100 to 1,000 only", () => {
    expect(parseRupees("500")).toBe(50_000);
    expect(parseRupees("₹1,000")).toBe(100_000);
    for (const bad of ["", "99", "1001", "50.5", "five", "-100", "100000"]) expect(parseRupees(bad)).toBeNull();
    expect(GOODWILL_MAX_RUPEES).toBe(1000);
  });
  it("a reason code is chosen and words are always needed", () => {
    expect(wordsProblem("", "enough words")).toBe("choose");
    expect(wordsProblem("billing_dispute", "ab")).toBe("say_what");
    expect(wordsProblem("billing_dispute", "double charged")).toBeNull();
  });
  it("a key is 8 to 64 of A-Z a-z 0-9 _ - and is new each time", () => {
    const a = newCreditKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newCreditKey()).not.toBe(a);
  });
});

describe("the mock source: the support thread", () => {
  it("lists by status; a reply moves the ticket to waiting and is saved on the thread, not sent", async () => {
    const { source } = src();
    expect(((await source.tickets("waiting")) as { data: { items: unknown[] } }).data.items).toHaveLength(0);
    const out = await source.reply(ticketId(1), "We are checking your quote.", "reply");
    expect(out.ok && out.data.status).toBe("waiting");
    expect(out.ok && out.data.messages.at(-1)).toMatchObject({ kind: "reply", delivered: false, body: "We are checking your quote." });
    expect(((await source.tickets("waiting")) as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  });
  it("a note changes nothing else; closing refuses a reply until it is reopened", async () => {
    const { source } = src();
    const note = await source.reply(ticketId(2), "Internal only", "note");
    expect(note.ok && note.data.status).toBe("open");
    await source.setStatus(ticketId(2), "closed");
    expect(await failure(source.reply(ticketId(2), "late", "reply"))).toBe("ticket_closed");
    await source.setStatus(ticketId(2), "open");
    expect((await source.reply(ticketId(2), "now ok", "reply")).ok).toBe(true);
  });
  it("assign to me / nobody; an unknown ticket is not_found; finance gets 'no_access' (the API's 403)", async () => {
    const { source } = src();
    const me = await source.assign(ticketId(1), "me");
    expect(me.ok && me.data.assignee).toBe("Gowtham");
    const none = await source.assign(ticketId(1), "none");
    expect(none.ok && none.data.assignee).toBeNull();
    expect(await failure(source.thread("10000000-0000-4000-8000-000000000099"))).toBe("not_found");
    const fin = src("finance").source;
    expect(await failure(fin.tickets("active"))).toBe("no_access");
    expect(await failure(fin.thread(ticketId(0)))).toBe("no_access");
  });
});

describe("the mock source: pause, resume, credit, unmask", () => {
  it("pause needs a reason (other needs words); resume lifts only support's own pause", async () => {
    const { source } = src("support");
    expect(await failure(source.pause(BIZ, "other", "x"))).toBe("reason_required");
    expect(await failure(source.resume(BIZ, "support_ticket", null))).toBe("invalid"); // the sample's owner-paused business: not support's to lift
    const paused = await source.pause("00000000-0000-4000-8000-000000000001", "incident", null);
    expect(paused.ok && paused.data.status).toBe("paused");
    const view = await source.businesses("sri lakshmi", null);
    expect(view.ok && view.data.items[0].status).toBe("paused");
    const back = await source.resume("00000000-0000-4000-8000-000000000001", "incident", null);
    expect(back.ok && back.data.status).toBe("live");
  });
  it("finance cannot pause or unmask; support cannot credit", async () => {
    expect(await failure(src("finance").source.pause(BIZ, "incident", null))).toBe("no_access");
    expect(await failure(src("finance").source.unmask(BIZ, `mock-access-${BIZ}`, "incident", "checking a complaint"))).toBe("no_access");
    expect(await failure(src("support").source.credit(BIZ, { amountPaise: 50_000, confirmPaise: 50_000, code: "billing_dispute", text: "double charged", key: "gw-12345678" }))).toBe("no_access");
  });
  it("credit: the amount typed twice, the words always; the money step needs a fresh code, then the same request works; the 30-day limit is plain", async () => {
    const { source } = src("finance");
    const input = { amountPaise: 50_000, confirmPaise: 50_000, code: "billing_dispute", text: "double charged", key: "gw-12345678" };
    expect(await failure(source.credit(BIZ, { ...input, confirmPaise: 40_000 }))).toBe("invalid");
    expect(await failure(source.credit(BIZ, { ...input, text: "" }))).toBe("invalid");
    expect(await failure(source.credit(BIZ, input))).toBe("second_confirm_required");
    await source.freshCode();
    const ok = await source.credit(BIZ, input);
    expect(ok.ok && ok.data.creditedText).toBe("₹500");
    expect(ok.ok && ok.data.balanceText).toBe("₹4,710");
    await source.credit(BIZ, { ...input, key: "gw-22222222" });
    await source.credit(BIZ, { ...input, key: "gw-33333333" }); // ₹1,500 so far
    for (const k of ["gw-44444444", "gw-55555555", "gw-66666666"]) await source.credit(BIZ, { ...input, amountPaise: 100_000, confirmPaise: 100_000, key: k });
    expect(await failure(source.credit(BIZ, { ...input, amountPaise: 100_000, confirmPaise: 100_000, key: "gw-77777777" }))).toBe("goodwill_limit");
  });
  it("unmask gives the real names for one look, after a second reason with words; without access it refuses", async () => {
    const { source } = src();
    expect(await failure(source.unmask(BIZ, "nope", "incident", "checking a complaint"))).toBe("access_required");
    expect(await failure(source.unmask(BIZ, `mock-access-${BIZ}`, "incident", ""))).toBe("reason_required");
    const out = await source.unmask(BIZ, `mock-access-${BIZ}`, "incident", "checking a complaint");
    expect(out.ok && out.data.calls[0].customerPhone).toBe("+91 98480 00210");
  });
  it("a sample that cannot remember (cookie full) says so rather than pretending", async () => {
    const full: MockJar = { read: async () => EMPTY_MOCK, write: async () => false };
    const r = await makeSource("mock", "t", "owner", () => NOW, full).reply(ticketId(1), "x", "note");
    expect(r).toEqual({ ok: false, failure: "unavailable" });
    expect(new ApiRequestError(503, "mock_full", "x").status).toBe(503);
  });
});
