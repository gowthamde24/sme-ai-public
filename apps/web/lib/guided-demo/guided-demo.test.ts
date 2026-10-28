import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  company: vi.fn(async (..._a: unknown[]) => undefined),
  contact: vi.fn(async (..._a: unknown[]) => "c"),
  lead: vi.fn(async (..._a: unknown[]) => "l"),
  testCall: vi.fn(),
  assistant: vi.fn(),
  preview: vi.fn(),
  ask: vi.fn(),
  draft: vi.fn(async (..._a: unknown[]) => ({})),
  slots: vi.fn(),
  book: vi.fn(async (..._a: unknown[]) => ({})),
}));
vi.mock("@/lib/api/customers", () => ({ createCustomerCompany: h.company, createContact: h.contact, createLead: h.lead }));
vi.mock("@/lib/api/ai-assistant", () => ({ postTestCall: h.testCall, getAiAssistant: h.assistant }));
vi.mock("@/lib/api/opening-line", () => ({ previewOpeningLine: h.preview }));
vi.mock("@/lib/api/assistant", () => ({ sendAssistantMessage: (...a: unknown[]) => h.ask(...a) }));
vi.mock("@/lib/api/followups", () => ({ createDraft: h.draft }));
vi.mock("@/lib/api/visits", () => ({ getSlots: h.slots, bookVisit: h.book }));

import { ApiAuthError } from "@/lib/api/client";

import { runDemoStep } from "./events";
import { clip, demoLead, routesFor, STEP_KEYS } from "./script";

const CTX = { token: "tok", tenantId: "22222222-2222-4222-8222-222222222222" };
const IN = { run: "abcd1234-0000", leadId: "33333333-3333-4333-8333-333333333333", question: "Price?" };
const BASE = `/app/tenants/${CTX.tenantId}`;
async function* events(list: unknown[]) {
  for (const e of list) yield e;
}
beforeEach(() => Object.values(h).forEach((f) => f.mockClear()));

describe("the story", () => {
  it("has six steps, each with its screen; a business type without the module of a screen shows Today for that step", () => {
    expect(STEP_KEYS).toHaveLength(6);
    const all = routesFor(BASE, null);
    expect(all.today).toBe(BASE);
    expect(all.lead).toBe(`${BASE}/customers`);
    const some = routesFor(BASE, []);
    expect(Object.values(some).every((p) => p === BASE || p.startsWith(BASE))).toBe(true);
    expect(some.lead).toBe(BASE); // no module at all: Today
  });
  it("the made-up lead is in the reserved demo number range, and a long text is cut", () => {
    expect(demoLead("ab12-cd34-9")).toEqual({ name: "Demo lead 1234", phone: "+00 000 000 1234" });
    expect(clip("x".repeat(600), 100)).toHaveLength(100);
    expect(clip("short")).toBe("short");
  });
});

describe("what the steps do", () => {
  it("lead: a company, a contact (demo number) and a WhatsApp lead; the lead id comes back", async () => {
    const out = await runDemoStep(CTX, "lead", IN);
    expect(out).toMatchObject({ ok: true, leadId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(h.contact.mock.calls[0][2]).toMatchObject({ phone: "+00 000 000 1234", email: null });
    expect(h.lead.mock.calls[0][2]).toMatchObject({ source: "whatsapp" });
  });
  it("reach: the test call's transcript and the sound of the opening line in the workspace's voice (no sound is still a call)", async () => {
    h.testCall.mockResolvedValue({ transcript: [{ speaker: "assistant", text: "Hello" }, { speaker: "customer", text: "Yes" }] });
    h.assistant.mockResolvedValue({ settings: { lang: "te" } });
    h.preview.mockResolvedValue({ audio: { base64: "AAAA", mime: "audio/wav", seconds: 1 }, fake: false });
    const out = await runDemoStep(CTX, "reach", IN);
    expect(out).toMatchObject({ ok: true, lines: [{ who: "assistant", text: "Hello" }, { who: "lead", text: "Yes" }], sound: { mime: "audio/wav" } });
    expect(h.preview).toHaveBeenCalledWith("tok", CTX.tenantId, "te");
    h.preview.mockRejectedValue(new Error("down"));
    expect(await runDemoStep(CTX, "reach", IN)).toMatchObject({ ok: true, sound: null });
  });
  it("ask: the question and the answer from the assistant; a refusal or silence says so and changes nothing", async () => {
    h.ask.mockReturnValue(events([{ type: "text", delta: "It is " }, { type: "text", delta: "Rs 500." }, { type: "done" }]));
    expect(await runDemoStep(CTX, "ask", IN)).toMatchObject({ ok: true, lines: [{ who: "lead", text: "Price?" }, { who: "assistant", text: "It is Rs 500." }], note: null });
    h.ask.mockReturnValue(events([{ type: "error", code: "budget", message: "x" }]));
    expect(await runDemoStep(CTX, "ask", IN)).toMatchObject({ ok: true, lines: [{ who: "lead" }], note: "none" });
    h.ask.mockImplementation(() => {
      throw new Error("down");
    });
    expect(await runDemoStep(CTX, "ask", IN)).toMatchObject({ ok: true, note: "none" });
  });
  it("followup: a WhatsApp DRAFT for the lead (nothing is sent); no lead, no step", async () => {
    expect(await runDemoStep(CTX, "followup", IN)).toMatchObject({ ok: true });
    expect(h.draft.mock.calls[0].slice(0, 3)).toEqual(["tok", CTX.tenantId, IN.leadId]);
    expect(h.draft.mock.calls[0][3]).toMatchObject({ channel: "whatsapp" });
    expect(await runDemoStep(CTX, "followup", { ...IN, leadId: null })).toEqual({ ok: false });
  });
  it("visit: the first free slot that is not past, today or the next days; none = the step fails", async () => {
    h.slots.mockResolvedValueOnce({ open: false, slots: [] }).mockResolvedValueOnce({ open: true, slots: [{ start: "10:00", free: 0, past: false }, { start: "11:00", free: 2, past: false }] });
    expect(await runDemoStep(CTX, "visit", IN)).toMatchObject({ ok: true });
    expect(h.book.mock.calls[0][2]).toMatchObject({ leadId: IN.leadId, slot: "11:00", partySize: 1 });
    h.slots.mockResolvedValue({ open: false, slots: [] });
    expect(await runDemoStep(CTX, "visit", IN)).toEqual({ ok: false });
  });
  it("today: nothing to do; any failure is { ok: false }, a lost sign-in is passed on", async () => {
    expect(await runDemoStep(CTX, "today", IN)).toMatchObject({ ok: true });
    h.lead.mockRejectedValueOnce(new Error("boom"));
    expect(await runDemoStep(CTX, "lead", IN)).toEqual({ ok: false });
    h.lead.mockRejectedValueOnce(new ApiAuthError("x"));
    await expect(runDemoStep(CTX, "lead", IN)).rejects.toBeInstanceOf(ApiAuthError);
  });
});
