import { describe, expect, it } from "vitest";

import { ACTIVITY_JSON, CANT_DO_JSON, CATALOGUE_PREVIEW_JSON, HOURS_PLAN_JSON, IMPORT_PLAN_JSON, PREVIEW_JSON, SECRET_JSON, SETUP_EMAIL_JSON, SETUP_INDIAMART_JSON, STAFF_PLAN_JSON, TENANT_BASE, planCardJson } from "./fixtures";
import { checkFile, fileKindOf, insideBase, MAX_FILE_BYTES, parseActivity, parsePlan, parseTestResult, parseUploadedFile, parseWorkCard, sinceFor, sizeLabel } from "./types";

const B = TENANT_BASE;

describe("files before an upload", () => {
  it("takes the kinds the job lists, by extension, whatever the case", () => {
    expect(["a.xlsx", "b.XLS", "c.csv", "d.pdf", "e.JPG", "f.jpeg", "g.png", "h.heic", "i.docx", "j.vcf", "k.txt"].map(fileKindOf)).toEqual(["sheet", "sheet", "sheet", "pdf", "image", "image", "image", "image", "doc", "contacts", "text"]);
    expect(fileKindOf("setup.exe")).toBeNull();
    expect(fileKindOf("noextension")).toBeNull();
    expect(fileKindOf("macro.xlsm")).toBeNull();
  });
  it("refuses a file over 20 MB, an empty one, a wrong kind and a sixth file, before anything is sent", () => {
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

describe("the cards of a turn (ASSUMED shapes)", () => {
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
    const card = parseWorkCard({ ...PREVIEW_JSON, counts: { found: 3, sparkle: 9, existing: -1 }, sample_rows: Array.from({ length: 9 }, () => ["<b>x</b>", 5, null, "d"]) }, B);
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
    expect(parseWorkCard(CANT_DO_JSON, B)).toMatchObject({ kind: "cant_do", reason: "screen_only", screen: { href: `${B}/settings?section=privacy` } });
    expect(parseWorkCard({ kind: "launch_rockets" }, B)).toBeNull();
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

describe("Settings > Activity (ASSUMED shape)", () => {
  it("reads the entries and drops a malformed one", () => {
    const got = parseActivity({ items: [...ACTIVITY_JSON.items, { action_id: "x" }], next_before: null });
    expect(got?.items).toHaveLength(5);
    expect(got?.items[0]).toMatchObject({ tool: "leads.import", requestedBy: "Srinivas Reddy", status: "done", undo: "available" });
    expect(got?.items[2].undo).toBe("none");
  });
  it("today and this week start at midnight India time (the week on Monday)", () => {
    const now = Date.parse("2026-11-04T10:00:00Z"); // a Wednesday, 3:30 pm in India
    expect(sinceFor("today", now)).toBe("2026-11-03T18:30:00.000Z");
    expect(sinceFor("week", now)).toBe("2026-11-01T18:30:00.000Z");
  });
});
