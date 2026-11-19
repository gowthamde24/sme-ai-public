import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "mock" | "on" } }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import { DRAFT_LANGS, fixAll, runChecks, warnings, type Message } from "@/lib/templates/meta-checks";
import { WIRE_OWN_MESSAGES, wireDraftFor } from "@/lib/templates/mock";
import { OWN_STATUSES, REJECTION_CODES } from "@/lib/templates/types";

import { parseDraftAnswer, parseOwnMessage, parseOwnMessages, readOwnMessages, submitOwnMessage, writeOwnMessage } from "./template-builder";

const T = "22222222-2222-4222-8222-222222222222";
const GOOD: Message = { category: "utility", drafts: { te: { header: null, body: "నమస్కారం {name} గారు, మీ order వచ్చింది.", footer: null, buttons: [] }, en: { header: null, body: "Hello {name}, your order has come.", footer: null, buttons: [] } } };
const wireWritten = (over: Record<string, unknown> = {}) => ({
  category: "utility",
  title: { en: "Order update", te: "Order అప్‌డేట్" },
  drafts: [
    { language: "te", header: null, body: "నమస్కారం {name} గారు, మీ order వచ్చింది.", footer: null, buttons: ["సరే"] },
    { language: "en", header: "Order", body: "Hello {name}, your order has come.", footer: null, buttons: [] },
  ],
  ...over,
});

beforeEach(() => {
  h.req.mockReset();
  h.mode.v = "mock";
});

describe("own messages: what the API sends", () => {
  it("reads a written message: both languages once each, a closed group, a short name", () => {
    const a = parseDraftAnswer(wireWritten());
    expect(a.kind).toBe("written");
    if (a.kind !== "written") return;
    expect(a.message.category).toBe("utility");
    expect(a.message.title).toEqual({ en: "Order update", te: "Order అప్‌డేట్" });
    expect(a.message.drafts.te.buttons).toEqual(["సరే"]);
    expect(a.message.drafts.en.header).toBe("Order");
    expect(a.message.drafts.en.footer).toBeNull();
  });
  it("an `unclear` answer is an answer, not an error", () => {
    expect(parseDraftAnswer({ unclear: true })).toEqual({ kind: "unclear" });
  });
  it("refuses a missing language, a repeated one, an unknown group or language, and any brace that is not the customer's name", () => {
    const d = wireWritten().drafts;
    expect(() => parseDraftAnswer(wireWritten({ drafts: [d[0]] }))).toThrow();
    expect(() => parseDraftAnswer(wireWritten({ drafts: [d[0], d[0]] }))).toThrow();
    expect(() => parseDraftAnswer(wireWritten({ category: "authentication" }))).toThrow();
    expect(() => parseDraftAnswer(wireWritten({ drafts: [d[0], { ...d[1], language: "fr" }] }))).toThrow();
    expect(() => parseDraftAnswer(wireWritten({ drafts: [d[0], { ...d[1], body: "Hello {{1}}, your order" }] }))).toThrow();
    expect(() => parseDraftAnswer(wireWritten({ drafts: [d[0], { ...d[1], body: "Hello {first_name}" }] }))).toThrow();
    expect(() => parseDraftAnswer(wireWritten({ drafts: [d[0], { ...d[1], buttons: ["a", "b", "c", "d"] }] }))).toThrow();
    expect(() => parseDraftAnswer(wireWritten({ title: { en: "  " } }))).toThrow();
  });

  it("reads the list of messages: status from the closed three, the reason only when it needs a change", () => {
    const items = parseOwnMessages(WIRE_OWN_MESSAGES);
    expect(items.map((m) => m.status)).toEqual(["waiting", "approved", "needs_change"]);
    expect(items[0].reason).toBeNull();
    expect(items[2].reason).toEqual({ code: "price_or_offer", params: { word: "discount" } });
    expect(new Set(items.map((m) => m.status))).toEqual(new Set(OWN_STATUSES));
  });
  it("a status the web does not know leaves that row out and keeps the others", () => {
    const rows = [...(WIRE_OWN_MESSAGES.items as unknown[]), { ...(WIRE_OWN_MESSAGES.items as Record<string, unknown>[])[0], id: "x", status: "exploded" }];
    expect(parseOwnMessages({ items: rows })).toHaveLength(3);
    expect(() => parseOwnMessage({ ...(WIRE_OWN_MESSAGES.items as Record<string, unknown>[])[0], status: "exploded" })).toThrow();
  });
  it("a reason code the web has no words for reads as `other`, and a message that needs a change always has a reason", () => {
    const row = { ...(WIRE_OWN_MESSAGES.items as Record<string, unknown>[])[2] };
    expect(parseOwnMessage({ ...row, reason: { code: "meta_internal_7", params: {} } }).reason?.code).toBe("other");
    expect(parseOwnMessage({ ...row, reason: null }).reason).toEqual({ code: "other", params: {} });
    expect(parseOwnMessage({ ...row, reason: { code: "price_or_offer", params: { word: "<b>x</b>" } } }).reason?.params).toEqual({});
    expect(REJECTION_CODES).toContain("other");
  });
});

describe("the mock writer", () => {
  it("understands the four closed sentences, in English or Telugu words, and answers unclear for the rest", () => {
    for (const [text, group] of [["Tell customers the blouse is ready for pickup", "utility"], ["Remind customers their order is out for delivery", "utility"], ["Remind them about tomorrow's visit", "utility"], ["Tell them about the festival offer", "marketing"], ["మీ blouse రెడీ అని చెప్పండి", "utility"]] as const) {
      const a = parseDraftAnswer(wireDraftFor(text));
      expect(a.kind, text).toBe("written");
      if (a.kind === "written") {
        expect(a.message.category).toBe(group);
        for (const l of DRAFT_LANGS) expect(a.message.drafts[l].body).toContain("{name}");
      }
    }
    expect(parseDraftAnswer(wireDraftFor("sing me a song"))).toEqual({ kind: "unclear" });
  });
  it("the blouse draft carries the two slips the checks catch, and one Fix all makes it sendable; the other drafts pass", () => {
    const blouse = parseDraftAnswer(wireDraftFor("the blouse is ready"));
    if (blouse.kind !== "written") throw new Error("no draft");
    const bad = warnings(runChecks(blouse.message)).map((r) => r.code);
    expect(bad).toEqual(["capitals", "name_edge"]);
    expect(warnings(runChecks(fixAll(blouse.message)))).toEqual([]);
    for (const text of ["out for delivery", "visit tomorrow", "festival offer"]) {
      const a = parseDraftAnswer(wireDraftFor(text));
      if (a.kind !== "written") throw new Error("no draft");
      expect(warnings(runChecks(a.message)), text).toEqual([]);
    }
  });
});

describe("the calls", () => {
  it("off: nothing is read; mock: the made-up list; on: GET .../own-templates, a contract error is thrown and any other failure reads as not there", async () => {
    h.mode.v = "off";
    expect(await readOwnMessages("tok", T)).toBeNull();
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "mock";
    expect(await readOwnMessages("tok", T)).toHaveLength(3);
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValueOnce(WIRE_OWN_MESSAGES);
    expect(await readOwnMessages("tok", T)).toHaveLength(3);
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/whatsapp/own-templates`, "tok");
    h.req.mockRejectedValueOnce(new Error("down"));
    expect(await readOwnMessages("tok", T)).toBeNull();
  });
  it("write: the sentence is trimmed and bounded; on sends {text, languages, previous?} to .../draft; mock sends nothing", async () => {
    await expect(writeOwnMessage("tok", T, { text: "ab" })).rejects.toThrow();
    await expect(writeOwnMessage("tok", T, { text: "x".repeat(501) })).rejects.toThrow();
    expect((await writeOwnMessage("tok", T, { text: "  the   blouse is ready " })).kind).toBe("written");
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValue(wireWritten());
    await writeOwnMessage("tok", T, { text: "order  update", previous: GOOD });
    const [path, token, init] = h.req.mock.calls[0];
    expect([path, token, init.method]).toEqual([`/v1/tenants/${T}/whatsapp/own-templates/draft`, "tok", "POST"]);
    const body = JSON.parse(init.body);
    expect(body.text).toBe("order update");
    expect(body.languages).toEqual(["te", "en"]);
    expect(body.previous.drafts.map((d: { language: string }) => d.language)).toEqual(["te", "en"]);
    expect(JSON.stringify(body)).not.toContain("{{");
  });
  it("submit: a message that fails its own checks is never asked for; mock answers Waiting and sends nothing; on posts {title, category, drafts}", async () => {
    const title = { en: "Order update", te: null };
    const shouted: Message = { ...GOOD, drafts: { ...GOOD.drafts, en: { ...GOOD.drafts.en, body: "Hello {name}, READY NOW" } } };
    await expect(submitOwnMessage("tok", T, { title, message: shouted })).rejects.toThrow();
    await expect(submitOwnMessage("tok", T, { title: { en: " ", te: null }, message: GOOD })).rejects.toThrow();
    const mock = await submitOwnMessage("tok", T, { title, message: GOOD }, "2026-11-19T05:12:00Z");
    expect(mock).toMatchObject({ status: "waiting", category: "utility", title, reason: null, submittedAt: "2026-11-19T05:12:00Z" });
    expect(h.req).not.toHaveBeenCalled();
    h.mode.v = "on";
    h.req.mockResolvedValue({ template: { id: "own-1", title, category: "utility", status: "waiting", submitted_at: "2026-11-19T05:12:00Z", decided_at: null, reason: null } });
    const sent = await submitOwnMessage("tok", T, { title, message: GOOD });
    expect(sent.status).toBe("waiting");
    const [path, , init] = h.req.mock.calls[0];
    expect([path, init.method]).toEqual([`/v1/tenants/${T}/whatsapp/own-templates`, "POST"]);
    expect(JSON.parse(init.body)).toMatchObject({ title: { en: "Order update" }, category: "utility" });
  });
});
