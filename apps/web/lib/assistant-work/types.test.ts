import { describe, expect, it } from "vitest";
import { fromAction, merge } from "@/lib/everything/model";
import type { ActivityEntry } from "./types";

import { ACTIVITY_JSON, CANT_DO_JSON, CATALOGUE_PREVIEW_JSON, HOURS_PLAN_JSON, IMPORT_PLAN_JSON, MULTI_PLAN_JSON, NOT_IN_PLAN_JSON, NOT_YET_JSON, PDF_NOT_YET_JSON, PREVIEW_JSON, PRICE_LIST_NOT_YET_JSON, SECRET_JSON, SETUP_EMAIL_JSON, SETUP_FORM_JSON, SETUP_HOURS_JSON, SETUP_INDIAMART_JSON, STAFF_PLAN_JSON, TENANT_BASE, planCardJson } from "./fixtures";
import { checkFile, FILE_ACCEPT, fileKindOf, insideBase, MAX_FILE_BYTES, parseActivity, parsePlan, parseTestResult, parseUploadedFile, parseWorkCard, sinceFor, sizeLabel } from "./types";

const B = TENANT_BASE;
/** A copy of a fixture without some of its fields. */
const without = (o: Record<string, unknown>, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

describe("files before an upload", () => {
  it("takes the contract's kinds, by extension, whatever the case", () => {
    expect(["a.xlsx", "b.XLS", "c.csv", "c2.tsv", "c3.ods", "d.pdf", "e.JPG", "f.jpeg", "g.png", "h.heic", "h2.HEIF", "i.docx", "j.vcf", "k.txt"].map((n) => fileKindOf(n))).toEqual(["sheet", "sheet", "sheet", "sheet", "sheet", "pdf", "image", "image", "image", "image", "image", "doc", "contacts", "text"]);
    expect(fileKindOf("setup.exe")).toBeNull();
    expect(fileKindOf("noextension")).toBeNull();
    expect(fileKindOf("macro.xlsm")).toBeNull();
    expect(fileKindOf("old.doc")).toBeNull();
  });
  it("a phone's photo with an EMPTY type is taken by its extension; a name without one by the browser's type; a wrong extension never by its type", () => {
    expect(fileKindOf("IMG_2041.HEIC", "")).toBe("image");
    expect(fileKindOf("IMG_2041.heif", "")).toBe("image");
    expect(fileKindOf("IMG_2043", "image/jpeg")).toBe("image");
    expect(fileKindOf("scan", "application/pdf; charset=binary")).toBe("pdf");
    expect(fileKindOf("rates", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("doc");
    expect(fileKindOf("setup.exe", "image/png")).toBeNull();
    expect(fileKindOf("blob", "application/octet-stream")).toBeNull();
    expect(fileKindOf("folder/sub/list.csv")).toBe("sheet");
    expect(checkFile({ name: "IMG_2041.HEIC", size: 10, type: "" }, 0)).toBeNull();
    expect(checkFile({ name: "IMG_2043", size: 10, type: "image/png" }, 0)).toBeNull();
  });
  it("the picker's accept lists the extensions and the types (a phone's picker filters by type)", () => {
    for (const x of [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".docx", ".xlsx", ".csv", ".vcf", ".txt", "image/heic", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) expect(FILE_ACCEPT.split(",")).toContain(x);
  });
  it("refuses a file over 10 MB (the contract), an empty one, a wrong kind and a sixth file, before anything is sent", () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(checkFile({ name: "list.xlsx", size: MAX_FILE_BYTES + 1 }, 0)).toBe("size");
    expect(checkFile({ name: "list.xlsx", size: MAX_FILE_BYTES }, 0)).toBeNull();
    expect(checkFile({ name: "list.xlsx", size: 0 }, 0)).toBe("empty");
    expect(checkFile({ name: "run.sh", size: 10 }, 0)).toBe("type");
    expect(checkFile({ name: "list.xlsx", size: 10 }, 5)).toBe("count");
  });
  it("writes a size as people read it", () => {
    expect(sizeLabel(900)).toBe("900 B");
    expect(sizeLabel(340 * 1024)).toBe("340 KB");
    expect(sizeLabel(1.25 * 1024 * 1024)).toBe("1.3 MB");
  });
  it("reads an upload's answer, and nothing that is not one", () => {
    expect(parseUploadedFile({ file_id: "b2000000-0000-4000-8000-000000000001", name: "a.csv", size_bytes: 12, kind: "sheet", expires_at: null })).toEqual({ fileId: "b2000000-0000-4000-8000-000000000001", name: "a.csv", size: 12, kind: "sheet", expiresAt: null });
    expect(parseUploadedFile({ file_id: "x", name: "a.csv", size_bytes: 12, kind: "sheet" })).toBeNull();
    expect(parseUploadedFile({ file_id: "b2000000-0000-4000-8000-000000000001", name: "a.csv", size_bytes: 12, kind: "binary" })).toBeNull();
  });
});

describe("the cards of a turn (the contract's shapes)", () => {
  it("every fixture is the contract's shape and is read", () => {
    for (const c of [PREVIEW_JSON, CATALOGUE_PREVIEW_JSON, planCardJson(MULTI_PLAN_JSON), planCardJson(STAFF_PLAN_JSON), planCardJson(HOURS_PLAN_JSON), SECRET_JSON, SETUP_INDIAMART_JSON, SETUP_EMAIL_JSON, SETUP_FORM_JSON, SETUP_HOURS_JSON, CANT_DO_JSON, NOT_YET_JSON, PRICE_LIST_NOT_YET_JSON, PDF_NOT_YET_JSON, NOT_IN_PLAN_JSON]) {
      const card = parseWorkCard(c, B);
      expect(card, JSON.stringify(c).slice(0, 80)).not.toBeNull();
      expect(card?.id).toBe(c.id);
    }
  });
  it("the shapes assumed before the contract are not read any more (preview_id, counts, sample_rows; card_id; setup_id; a secret without its own id)", () => {
    expect(parseWorkCard({ ...without(PREVIEW_JSON, "id", "facts", "rows"), preview_id: PREVIEW_JSON.id, counts: { found: 1 }, sample_rows: [] }, B)).toBeNull();
    expect(parseWorkCard({ ...without(CANT_DO_JSON, "id"), card_id: CANT_DO_JSON.id }, B)).toBeNull();
    expect(parseWorkCard({ ...without(SETUP_FORM_JSON, "id"), setup_id: SETUP_FORM_JSON.id }, B)).toBeNull();
    expect(parseWorkCard(without(SECRET_JSON, "id"), B)).toBeNull();
    expect(parseWorkCard({ kind: "plan", plan: HOURS_PLAN_JSON }, B)).toBeNull(); // a plan card has its own id
  });
  it("a secret card keeps its own id and the request id the value goes to", () => {
    expect(parseWorkCard(SECRET_JSON, B)).toMatchObject({ kind: "secret", id: SECRET_JSON.id, requestId: SECRET_JSON.request_id });
    const setup = parseWorkCard(SETUP_INDIAMART_JSON, B);
    if (setup?.kind !== "setup") throw new Error("no setup");
    expect(setup.secret).toMatchObject({ id: SETUP_INDIAMART_JSON.secret.id, requestId: SETUP_INDIAMART_JSON.secret.request_id });
  });
  it("a plan card's id is the card's, not the plan's", () => {
    const card = parseWorkCard(planCardJson(HOURS_PLAN_JSON), B);
    expect(card?.id).not.toBe(HOURS_PLAN_JSON.plan_id);
    expect(card?.kind === "plan" ? card.plan.planId : null).toBe(HOURS_PLAN_JSON.plan_id);
  });
  it("a plan or a step without its state is not drawn (it could have run already); a preview whose plan does not read is not drawn as 'nobody new'", () => {
    expect(parsePlan(without(HOURS_PLAN_JSON, "status"))).toBeNull();
    expect(parsePlan({ ...HOURS_PLAN_JSON, steps: [{ tool: "a", summary: "b", undoable: true }] })).toBeNull();
    expect(parseWorkCard({ ...PREVIEW_JSON, plan: { plan_id: "nope" } }, B)).toBeNull();
    expect(parseWorkCard({ ...PREVIEW_JSON, plan: null }, B)).toMatchObject({ kind: "file_preview", plan: null });
  });
  it("PDF, photo and Word: the contract's 'can't do yet' card, with About my business where this app draws it", () => {
    expect(parseWorkCard(PDF_NOT_YET_JSON, B)).toEqual({ kind: "cant_do", id: PDF_NOT_YET_JSON.id, reason: "not_yet", what: PDF_NOT_YET_JSON.what, screen: { label: "About my business", href: `${B}/settings?section=assistant#knowledge` }, upgradeTo: null });
    expect(parseWorkCard(PRICE_LIST_NOT_YET_JSON, B)).toMatchObject({ reason: "not_yet", screen: { href: `${B}/catalogue` } });
    expect(parseWorkCard(CANT_DO_JSON, B)).toMatchObject({ reason: "screen_only", screen: { href: `${B}/settings?section=data` } });
  });
  it("not in the plan (PR #317): part of AI Workforce, with the Plans link; an upgrade to a product it has no words for is not drawn", () => {
    expect(parseWorkCard(NOT_IN_PLAN_JSON, B)).toEqual({ kind: "cant_do", id: NOT_IN_PLAN_JSON.id, reason: "not_in_plan", what: "Finding new retailers in Guntur", screen: { label: "Plans", href: `${B}/plans` }, upgradeTo: "ai_workforce" });
    expect(parseWorkCard({ ...NOT_IN_PLAN_JSON, upgrade_to: "platinum" }, B)).toBeNull();
    expect(parseWorkCard(without(NOT_IN_PLAN_JSON, "upgrade_to"), B)).toBeNull();
    expect(parseWorkCard({ ...NOT_YET_JSON, upgrade_to: "ai_workforce" }, B)).toMatchObject({ reason: "not_yet", upgradeTo: null }); // only with not_in_plan
    expect(parseWorkCard({ ...NOT_IN_PLAN_JSON, screen: { label: "Pay now", href: "https://pay.example/checkout" } }, B)).toMatchObject({ screen: null }); // never a link out of the workspace
  });
  it("unknown card kinds are skipped, never a crash", () => {
    for (const x of [{ kind: "launch_rockets", id: PREVIEW_JSON.id }, { kind: "file_preview" }, null, "card", 7, [], { id: PREVIEW_JSON.id }]) expect(parseWorkCard(x, B)).toBeNull();
  });
  it("a file's preview: the counts in a fixed order, the sample rows, where it goes and its plan", () => {
    const card = parseWorkCard(PREVIEW_JSON, B);
    expect(card?.kind).toBe("file_preview");
    if (card?.kind !== "file_preview") return;
    expect(card.facts).toEqual([{ code: "found", n: 38 }, { code: "existing", n: 4 }, { code: "no_phone", n: 2 }, { code: "supplier", n: 1 }]);
    expect(card.rows).toHaveLength(3);
    expect(card.rows[0]).toEqual(["Lakshmi Prasanna", "+00 000 000 6701", "Guntur", "Kanchi pattu, 40 sarees"]);
    expect(card.destination).toBe("leads");
    expect(card.plan?.steps).toHaveLength(2);
  });
  it("drops a count it has no words for, caps the rows at five, and keeps the cells as text", () => {
    const card = parseWorkCard({ ...PREVIEW_JSON, facts: [{ code: "found", n: 3 }, { code: "sparkle", n: 9 }, { code: "existing", n: -1 }, { code: "found", n: 99 }, "junk"], rows: Array.from({ length: 9 }, () => ["<b>x</b>", 5, null, "d"]) }, B);
    if (card?.kind !== "file_preview") throw new Error("no preview");
    expect(card.facts).toEqual([{ code: "found", n: 3 }]);
    expect(card.rows).toHaveLength(5);
    expect(card.rows[0]).toEqual(["<b>x</b>", "5", "", "d"]);
  });
  it("a sensitive plan is always the Owner's; an unknown kind of sensitive is not drawn at all (never treated as harmless)", () => {
    expect(parsePlan(STAFF_PLAN_JSON)).toMatchObject({ sensitive: "members", ownerOnly: true });
    expect(parsePlan(CATALOGUE_PREVIEW_JSON.plan)).toMatchObject({ sensitive: "money", ownerOnly: true });
    expect(parsePlan(HOURS_PLAN_JSON)).toMatchObject({ sensitive: null, ownerOnly: true });
    expect(parsePlan(IMPORT_PLAN_JSON)).toMatchObject({ sensitive: null, ownerOnly: false });
    expect(parsePlan({ ...STAFF_PLAN_JSON, sensitive: "rockets" })).toBeNull();
  });
  it("a plan needs an id, a title and one to twenty well-formed steps", () => {
    expect(parsePlan({ ...IMPORT_PLAN_JSON, plan_id: "nope" })).toBeNull();
    expect(parsePlan({ ...IMPORT_PLAN_JSON, steps: [] })).toBeNull();
    expect(parsePlan({ ...IMPORT_PLAN_JSON, steps: [{ tool: "x" }] })).toBeNull();
    expect(parsePlan({ ...IMPORT_PLAN_JSON, steps: Array.from({ length: 21 }, () => ({ tool: "a", summary: "b" })) })).toBeNull();
    expect(parsePlan({ ...IMPORT_PLAN_JSON, steps: [{ tool: "a", summary: "b", status: "failed", error: "weird" }] })?.steps[0]).toMatchObject({ status: "failed", error: "down" });
  });
  it("a plan card, a secret card (never a value), a setup card with its key box, and can't-do", () => {
    expect(parseWorkCard(planCardJson(HOURS_PLAN_JSON), B)?.kind).toBe("plan");
    const secret = parseWorkCard({ ...SECRET_JSON, value: "SHOULD-NOT-SURVIVE" }, B);
    expect(secret).toMatchObject({ kind: "secret", secret: "indiamart_key", saved: null });
    expect(JSON.stringify(secret)).not.toContain("SHOULD-NOT-SURVIVE");
    const setup = parseWorkCard(SETUP_INDIAMART_JSON, B);
    expect(setup).toMatchObject({ kind: "setup", setup: "indiamart", test: "pull_now", screen: { label: "Lead sources", href: `${B}/lead-sources` } });
    if (setup?.kind === "setup") expect(setup.secret?.kind).toBe("secret");
    const email = parseWorkCard(SETUP_EMAIL_JSON, B);
    if (email?.kind !== "setup") throw new Error("no setup");
    expect(email.portals.map((p) => p.name)).toEqual(["JustDial", "TradeIndia"]);
    expect(email.lastTest).toMatchObject({ ok: false, reason: "nothing_arrived" });
    expect(parseWorkCard(CANT_DO_JSON, B)).toMatchObject({ kind: "cant_do", reason: "screen_only", what: "Opening the real-data gate" });
    expect(parseWorkCard({ kind: "launch_rockets", id: CANT_DO_JSON.id }, B)).toBeNull();
  });
  it("a saved key keeps at most four plain characters", () => {
    expect(parseWorkCard({ ...SECRET_JSON, saved: { last4: "1234" } }, B)).toMatchObject({ saved: { last4: "1234" } });
    expect(parseWorkCard({ ...SECRET_JSON, saved: { last4: "the-whole-key" } }, B)).toMatchObject({ saved: { last4: null } });
  });
  it("keeps a link only when it stays inside this workspace", () => {
    expect(insideBase("/leads", B)).toBe(`${B}/leads`);
    expect(insideBase(`${B}/orders`, B)).toBe(`${B}/orders`);
    expect(insideBase("https://evil.example/x", B)).toBeNull();
    expect(insideBase("//evil.example/x", B)).toBeNull();
    expect(insideBase("/app/tenants/22222222-2222-4222-8222-222222222222/leads", B)).toBeNull();
    expect(insideBase("/../../etc", B)).toBeNull();
    expect(insideBase("javascript:alert(1)", B)).toBeNull();
    const cant = parseWorkCard({ ...CANT_DO_JSON, screen: { label: "x", href: "https://evil.example" } }, B);
    expect(cant).toMatchObject({ screen: null });
  });
  it("a live test's result, failed or not", () => {
    expect(parseTestResult({ ok: true })).toEqual({ ok: true, reason: null, detail: null, at: null });
    expect(parseTestResult({ ok: false, reason: "made_up" })).toMatchObject({ ok: false, reason: "other" });
    expect(parseTestResult({ ok: "yes" })).toBeNull();
  });
});

describe("Settings > Activity (the contract's shape)", () => {
  it("reads the entries and drops a malformed one", () => {
    const got = parseActivity({ items: [...ACTIVITY_JSON.items, { action_id: "x" }], next_before: null });
    expect(got?.items).toHaveLength(5);
    expect(got?.items[0]).toMatchObject({ tool: "lead-imports.commit", requestedBy: "Srinivas Reddy", status: "done", undo: "available" });
    expect(got?.items[2].undo).toBe("none");
  });
  it("today and this week start at midnight India time (the week on Monday)", () => {
    const now = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, 3:30 pm in India
    expect(sinceFor("today", now)).toBe("2026-11-03T18:30:00.000Z");
    expect(sinceFor("week", now)).toBe("2026-11-01T18:30:00.000Z");
  });
});

describe("Everything it did (app v4 part 8): one merged timeline", () => {
  const A = (id: string, at: string, o: Partial<ActivityEntry> = {}): ActivityEntry => ({ actionId: id, tool: "t", summary: `did ${id}`, changed: null, requestedBy: null, messageId: null, at, status: "done", undo: "available", error: null, ...o });
  const NOW = Date.parse("2026-11-09T12:00:00Z");
  it("keeps the last 7 days, newest first, at most 50 from each source; Undo only where the API says it is available", () => {
    const old = A("old", "2026-11-01T00:00:00Z");
    const many = Array.from({ length: 60 }, (_, i) => fromAction(A(`a${i}`, new Date(NOW - i * 60_000).toISOString())));
    const out = merge([[fromAction(old)], many, [fromAction(A("x", "2026-11-09T11:59:30Z", { undo: "expired" }))]], NOW);
    expect(out.find((e) => e.id === "a:old")).toBeUndefined();
    expect(out.filter((e) => e.id.startsWith("a:a")).length).toBe(50);
    expect(out[0].id).toBe("a:a0");
    expect(out.find((e) => e.id === "a:x")?.undo).toBeNull();
    expect(out.find((e) => e.id === "a:a0")?.undo).toBe("a0");
    for (let i = 1; i < out.length; i++) expect(Date.parse(out[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(out[i].at));
  });
  it("a done action can be undone, an undone or failed one cannot", () => {
    expect(fromAction(A("u", "2026-11-09T11:00:00Z", { status: "undone" })).undo).toBeNull();
    expect(fromAction(A("f", "2026-11-09T11:00:00Z", { status: "failed" })).undo).toBeNull();
  });
});
