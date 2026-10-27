import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), know: { listSources: vi.fn(), listFacts: vi.fn(), draftFacts: vi.fn(), decideFact: vi.fn(), addPasteSource: vi.fn(), addFileSource: vi.fn(), addFact: vi.fn(), editFact: vi.fn(), discardSource: vi.fn() }, pb: { getPlaybook: vi.fn(), putPlaybook: vi.fn(), resetPlaybook: vi.fn() }, desk: { listDeskLeads: vi.fn(), setLeadOwner: vi.fn(), getTouches: vi.fn() } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? void h.jar.delete(k) : void h.jar.set(k, v)) }) }));
vi.mock("@/lib/api/knowledge", () => h.know);
vi.mock("@/lib/api/lead-playbook", () => h.pb);
vi.mock("@/lib/api/lead-desk", async (orig) => ({ ...(await orig<typeof import("@/lib/api/lead-desk")>()), ...h.desk }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import * as k from "./knowledge-source";
import { assignLead, readDeskLeads, readTouches } from "./leads-source";
import { readPlaybook, resetToTemplate, savePlaybook } from "./playbook-source";

const CTX = { token: "tok", tenantId: "22222222-2222-4222-8222-222222222222" };
const UCTX = { ...CTX, userId: "44444444-4444-4444-8444-444444444444" };
const S1 = "55555555-5555-4555-8555-555555555555";
const TEXT = "We sell two bedroom flats near Gachibowli. Flats start at ₹45 lakh. We are open Monday to Saturday, 9 am to 6 pm.";

beforeEach(() => {
  h.jar.clear();
  for (const g of Object.values(h)) if (typeof g === "object" && !(g instanceof Map)) for (const f of Object.values(g)) (f as ReturnType<typeof vi.fn>).mockReset();
  vi.unstubAllEnvs();
});

describe("the knowledge base, off, in test mode and from the API", () => {
  it("off: nothing is read and every change is refused", async () => {
    expect(await k.readKnowledge(CTX)).toBeNull();
    expect(await k.addPaste(CTX, { sourceId: S1, title: "t", text: TEXT })).toEqual({ ok: false, error: "not_available" });
    expect(await k.decide(CTX, S1, "approve")).toEqual({ ok: false, error: "not_available" });
  });
  it("test mode: paste, draft, edit (back to draft), approve, reject, and a second draft keeps what was decided", async () => {
    vi.stubEnv("LEADS_SCREENS", "mock");
    const added = await k.addPaste(CTX, { sourceId: S1, title: "My site", text: TEXT });
    expect(added.ok && added.value).toMatchObject({ title: "My site", status: "read" });
    expect((await k.addPaste(CTX, { sourceId: S1, title: "My site", text: TEXT })).ok).toBe(true); // the same id is the same source
    const made = await k.draft(CTX, S1);
    expect(made.ok && made.value.map((f) => f.kind)).toEqual(["location", "price", "hours"]);
    const facts = made.ok ? made.value : [];
    const approved = await k.decide(CTX, facts[0].id, "approve");
    expect(approved.ok && approved.value.status).toBe("approved");
    const edited = await k.edit(CTX, facts[0].id, { text: "We sell two and three bedroom flats." });
    expect(edited.ok && edited.value).toMatchObject({ status: "draft", edited: true, text: "We sell two and three bedroom flats." });
    expect((await k.decide(CTX, facts[1].id, "reject")).ok).toBe(true);
    const again = await k.draft(CTX, S1);
    expect(again.ok).toBe(false); // nothing new to draft: the text is gone and the decided facts stay
    const read = (await k.readKnowledge(CTX))!;
    expect(read.facts.map((f) => f.status).sort()).toEqual(["draft", "draft", "rejected"]);
    expect(read.sources[0].facts).toMatchObject({ rejected: 1 });
  });
  it("test mode: a fact written by hand starts as a draft; links and short text are refused; a file must be plain text", async () => {
    vi.stubEnv("LEADS_SCREENS", "mock");
    const f = await k.addManual(CTX, { factId: S1, kind: "hours", text: "Open Monday to Saturday." });
    expect(f.ok && f.value.status).toBe("draft");
    expect(await k.addManual(CTX, { factId: S1, kind: "other", text: "see https://x.example" })).toEqual({ ok: false, error: "invalid" });
    expect(await k.addFile(CTX, { sourceId: S1, title: "b", filename: "b.pdf", contentType: "application/pdf", contentBase64: "AAAA" })).toEqual({ ok: false, error: "unsupported" });
    expect(await k.addFile(CTX, { sourceId: S1, title: "b", filename: "b.txt", contentType: "text/plain", contentBase64: "   " })).toEqual({ ok: false, error: "no_text" });
    const txt = await k.addFile(CTX, { sourceId: S1, title: "price list", filename: "p.txt", contentType: "text/plain", contentBase64: Buffer.from(TEXT).toString("base64") });
    expect(txt.ok && txt.value.kind).toBe("file");
    expect(await k.addFile(CTX, { sourceId: S1, title: "big", filename: "b.txt", contentType: "text/plain", contentBase64: "A".repeat(7_000_000) })).toEqual({ ok: false, error: "too_large" });
  });
  it("from the API: names the refusals and does not swallow an expired sign-in", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    const refuse = async (status: number, code: string) => {
      h.know.decideFact.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      return k.decide(CTX, S1, "approve");
    };
    expect(await refuse(403, "mfa_required")).toEqual({ ok: false, error: "mfa" });
    expect(await refuse(403, "workspace_read_only")).toEqual({ ok: false, error: "read_only" });
    expect(await refuse(413, "source_too_large")).toEqual({ ok: false, error: "too_large" });
    expect(await refuse(415, "unsupported_type")).toEqual({ ok: false, error: "unsupported" });
    expect(await refuse(503, "reader_unavailable")).toEqual({ ok: false, error: "reader" });
    expect(await refuse(422, "unreadable_file")).toEqual({ ok: false, error: "unreadable" });
    expect(await refuse(403, "forbidden")).toEqual({ ok: false, error: "forbidden" });
    expect(await refuse(500, "boom")).toEqual({ ok: false, error: "down" });
    h.know.listSources.mockRejectedValueOnce(new ApiAuthError());
    await expect(k.readKnowledge(CTX)).rejects.toBeInstanceOf(ApiAuthError);
    h.know.listSources.mockRejectedValueOnce(new Error("down"));
    expect(await k.readKnowledge(CTX)).toBeNull();
  });
});

const read = { templatePack: "real_estate", saved: false, safety: [], updatedAt: null };
const body = { goalAsk: "Book a visit when they are ready.", questions: [{ field: "need", ask: "What are you looking for?", required: true }, { field: "budget", ask: "What budget range?", required: true }], objections: [], followups: [], raw: {} };

describe("the playbook", () => {
  it("off: nothing", async () => {
    expect(await readPlaybook(CTX, null)).toBeNull();
    expect(await savePlaybook(CTX, { ...read, playbook: body, defaults: body }, {})).toEqual({ ok: false, error: "not_available" });
  });
  it("test mode: starts from the standard of the template, saves the owner's edit, goes back to the standard", async () => {
    vi.stubEnv("LEADS_SCREENS", "mock");
    const first = (await readPlaybook(CTX, "gym"))!;
    expect(first).toMatchObject({ templatePack: "gym", saved: false });
    expect(first.playbook?.goalAsk).toMatch(/trial visit/);
    const saved = await savePlaybook(CTX, first, { goalAsk: "Book a trial visit this week.", questions: [{ field: "need", ask: "What do you want from a gym?", required: true }] });
    expect(saved.ok && saved.value.saved).toBe(true);
    const after = (await readPlaybook(CTX, "gym"))!;
    expect(after.saved).toBe(true);
    expect(after.playbook?.questions).toHaveLength(1);
    expect(await savePlaybook(CTX, after, { goalAsk: "It costs ₹500", questions: [{ field: "need", ask: "What do you need?", required: true }] })).toEqual({ ok: false, error: "price_or_promise" });
    expect(await savePlaybook(CTX, after, { goalAsk: "Book a trial visit this week.", questions: [{ field: "secret", ask: "What do you need?", required: true }] })).toEqual({ ok: false, error: "invalid" });
    const reset = await resetToTemplate(CTX, after);
    expect(reset.ok && reset.value.saved).toBe(false);
    expect((await readPlaybook(CTX, "gym"))!.saved).toBe(false);
    expect((await readPlaybook(CTX, "textiles"))?.templatePack).toBe("auto_dealer"); // a deep type has none: the test screens show the first template
  });
  it("a deep business type has no playbook to change; the API's refusals are named", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    expect(await savePlaybook(CTX, { ...read, templatePack: null, playbook: null, defaults: null }, {})).toEqual({ ok: false, error: "no_template" });
    const refuse = async (status: number, code: string, reason?: string) => {
      h.pb.putPlaybook.mockRejectedValueOnce(new ApiRequestError(status, code, "x", reason));
      return savePlaybook(CTX, { ...read, playbook: body, defaults: body }, { goalAsk: "Book a visit when ready.", questions: [{ field: "need", ask: "What do you need?", required: true }] });
    };
    expect(await refuse(403, "mfa_required")).toEqual({ ok: false, error: "mfa" });
    expect(await refuse(409, "no_template")).toEqual({ ok: false, error: "no_template" });
    expect(await refuse(422, "playbook_invalid", "price_or_promise")).toEqual({ ok: false, error: "price_or_promise" });
    expect(await refuse(422, "playbook_invalid", "unknown_field")).toEqual({ ok: false, error: "invalid" });
    h.pb.getPlaybook.mockRejectedValueOnce(new Error("down"));
    expect(await readPlaybook(CTX, null)).toBeNull();
  });
});

describe("the leads", () => {
  it("off: nothing and no assignment", async () => {
    expect(await readDeskLeads(UCTX, [])).toBeNull();
    expect(await assignLead(UCTX, S1, null)).toEqual({ ok: false, error: "not_available" });
    expect(await readTouches(UCTX, S1)).toBeNull();
  });
  it("test mode: hands a lead to someone and takes it back, and reads the arrivals of a lead", async () => {
    vi.stubEnv("LEADS_SCREENS", "mock");
    const before = (await readDeskLeads(UCTX, []))!;
    const lead = before.leads[1];
    expect(lead.ownerUserId).toBeNull();
    expect(await assignLead(UCTX, lead.id, UCTX.userId)).toEqual({ ok: true });
    expect((await readDeskLeads(UCTX, []))!.leads[1].ownerUserId).toBe(UCTX.userId);
    expect(await assignLead(UCTX, lead.id, null)).toEqual({ ok: true });
    expect((await readDeskLeads(UCTX, []))!.leads[1].ownerUserId).toBeNull();
    const t = (await readTouches(UCTX, lead.id))!;
    expect(t.items[0]).toMatchObject({ kind: "first" });
    expect(await readTouches(UCTX, "00000000-0000-4000-8000-000000000999")).toBeNull();
  });
  it("from the API: reads a page, marks the hot ones, maps the refusals of an assignment", async () => {
    vi.stubEnv("LEADS_SCREENS", "1");
    h.desk.listDeskLeads.mockResolvedValueOnce({ leads: [{ id: S1, contactId: "c1", name: "Ravi", source: "indiamart", status: "new", ownerUserId: null, createdAt: "2026-10-27T00:00:00Z", hot: false }], nextCursor: "n" });
    const page = (await readDeskLeads(UCTX, [{ id: "h", leadId: S1, contactId: "c1", contactName: "Ravi", summary: "s", assignedTo: "u", notifiedAt: "x", reminderSentAt: null, actedAt: null }]))!;
    expect(page.leads[0].hot).toBe(true);
    expect(page.nextCursor).toBe("n");
    const refuse = async (status: number, code: string) => {
      h.desk.setLeadOwner.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      return assignLead(UCTX, S1, UCTX.userId);
    };
    expect(await refuse(403, "forbidden")).toEqual({ ok: false, error: "forbidden" });
    expect(await refuse(409, "workspace_read_only")).toEqual({ ok: false, error: "read_only" });
    expect(await refuse(422, "validation_error")).toEqual({ ok: false, error: "invalid" });
    expect(await refuse(500, "boom")).toEqual({ ok: false, error: "down" });
    h.desk.listDeskLeads.mockRejectedValueOnce(new ApiAuthError());
    await expect(readDeskLeads(UCTX, [])).rejects.toBeInstanceOf(ApiAuthError);
    h.desk.listDeskLeads.mockRejectedValueOnce(new Error("down"));
    expect(await readDeskLeads(UCTX, [])).toBeNull();
  });
});
