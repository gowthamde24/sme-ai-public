import { actOnSheetLink, createSheetLink, getSheetAccess, importLeads, listLeadImports, listSheetLinks, parseCounts, previewLeads, readLeads } from "@/lib/api/lead-imports";
import { readJar, writeJar } from "@/lib/mock/jar";
import { leadsScreens } from "@/lib/screens/flag";

import { leadFailure } from "../failure";
import { fingerprint, mockPreview, mockRead, SAMPLE_SHEET } from "./mock";
import { mappingHasContact, type Counts, type ImportBody, type ImportItem, type ImportResult, type Out, type PreviewBody, type PreviewResult, type ReadBody, type ReadResult, type SheetAccess, type SheetLink, type SheetLinkBody } from "./types";

/**
 * Where the lead imports come from and go (night 4, Lead Desk, item 3). `mock` = test mode: the read and the preview are worked out from the text itself (lib/lead-desk/imports/mock.ts) and the recent imports and the
 * kept sheets live in ONE small cookie (lib/mock/jar.ts); `on` = C1's API (lib/api/lead-imports.ts); `off` = the parts are not there. SERVER ONLY. A role check is NOT made here (the caller does it).
 */
export const importMode = leadsScreens;
export const MOCK_COOKIE = "sme_leadimports_mock";
export type Ctx = { token: string; tenantId: string };
export type RecentImports = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; items: ImportItem[]; test: boolean };
export type SheetState = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; access: SheetAccess; links: SheetLink[]; test: boolean };

type MockImport = { id: string; kind: string; source: string; rows: number; counts: Counts; fp: string; consent: boolean; at: string };
type MockLink = { id: string; status: SheetLink["status"]; at: string | null; rows: number | null; created: string };
type Jar = { imports: MockImport[]; links: MockLink[] };

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function parseJar(v: unknown): Jar | null {
  if (!rec(v) || !Array.isArray(v.imports) || !Array.isArray(v.links)) return null;
  const imports: MockImport[] = [];
  for (const i of v.imports.slice(0, 8)) {
    if (!rec(i) || typeof i.id !== "string" || typeof i.kind !== "string" || typeof i.source !== "string" || typeof i.rows !== "number" || typeof i.fp !== "string" || typeof i.at !== "string" || !rec(i.counts)) continue;
    let counts: Counts;
    try {
      counts = parseCounts(i.counts);
    } catch {
      continue;
    }
    imports.push({ id: i.id, kind: i.kind, source: i.source, rows: i.rows, counts, fp: i.fp, consent: i.consent === true, at: i.at });
  }
  const links: MockLink[] = [];
  for (const l of v.links.slice(0, 4)) {
    if (!rec(l) || typeof l.id !== "string" || typeof l.created !== "string" || !["active", "paused", "needs_attention"].includes(String(l.status))) continue;
    links.push({ id: l.id, status: l.status as SheetLink["status"], at: typeof l.at === "string" ? l.at : null, rows: typeof l.rows === "number" ? l.rows : null, created: l.created });
  }
  return { imports, links };
}
const EMPTY: Jar = { imports: [], links: [] };
const readMock = (): Promise<Jar> => readJar(MOCK_COOKIE, parseJar, EMPTY);
/** The jar holds about 3.5 KB: when it does not fit, the oldest import goes (never the newest). */
async function saveMock(jar: Jar): Promise<boolean> {
  const next = { imports: [...jar.imports], links: [...jar.links] };
  for (;;) {
    if (await writeJar(MOCK_COOKIE, next)) return true;
    if (next.imports.length <= 1) return false;
    next.imports.pop();
  }
}
const asLink = (l: MockLink): SheetLink => ({ id: l.id, status: l.status, source: "google_sheet", last_synced_at: l.at, last_row_count: l.rows, last_result: l.at ? { ready: l.rows ?? 0 } : null, last_error: null, created_at: l.created, next_sync_at: l.status === "active" ? l.created : null });
const SAMPLE_ROWS = SAMPLE_SHEET.split("\n").length - 1;

export async function readStep(ctx: Ctx, body: ReadBody): Promise<Out<ReadResult>> {
  const mode = importMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    const out = mockRead(body);
    return out.ok ? { ok: true, data: out.read } : out;
  }
  try {
    return { ok: true, data: await readLeads(ctx.token, ctx.tenantId, body) };
  } catch (error) {
    return leadFailure(error);
  }
}

export async function previewStep(ctx: Ctx, body: PreviewBody): Promise<Out<PreviewResult>> {
  const mode = importMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    const out = mockPreview(body);
    return out.ok ? { ok: true, data: out.preview } : out;
  }
  try {
    return { ok: true, data: await previewLeads(ctx.token, ctx.tenantId, body) };
  } catch (error) {
    return leadFailure(error);
  }
}

export async function importStep(ctx: Ctx, body: ImportBody, now: Date = new Date()): Promise<Out<ImportResult>> {
  const mode = importMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, data: await importLeads(ctx.token, ctx.tenantId, body) };
    } catch (error) {
      return leadFailure(error);
    }
  }
  const out = mockPreview({ ...body, consent_confirmed: body.consent !== null });
  if (!out.ok) return out;
  const jar = await readMock();
  const fp = fingerprint(body);
  const consentId = body.consent ? `00000000-0000-4000-8000-${fp.padStart(12, "0")}` : null;
  const mine = jar.imports.find((i) => i.id === body.import_id);
  if (mine && mine.fp !== fp) return { ok: false, error: "import_id_used" };
  const created = mine ? mine.at : now.toISOString();
  const result: ImportResult = { import_id: body.import_id, status: "done", source: out.preview.source, consent_id: consentId, counts: out.preview.counts, problems: out.preview.problems.slice(0, 20), created_at: created };
  if (!mine) {
    const kept = await saveMock({ ...jar, imports: [{ id: body.import_id, kind: body.kind, source: out.preview.source, rows: out.preview.rows_read, counts: out.preview.counts, fp, consent: body.consent !== null, at: created }, ...jar.imports].slice(0, 5) });
    if (!kept) return { ok: false, error: "too_many" };
  }
  return { ok: true, data: result };
}

export async function recentImports(ctx: Ctx): Promise<RecentImports> {
  const mode = importMode();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") {
    const jar = await readMock();
    return { mode: "ok", test: true, items: jar.imports.map((i) => ({ import_id: i.id, kind: i.kind, source: i.source, rows_read: i.rows, counts: i.counts, problems: [], consent_id: i.consent ? i.id : null, by: null, created_at: i.at })) };
  }
  try {
    return { mode: "ok", test: false, items: await listLeadImports(ctx.token, ctx.tenantId, 10) };
  } catch (error) {
    leadFailure(error);
    return { mode: "unavailable" };
  }
}

/** The modes of sharing a sheet and the sheets kept in sync (Owner and Admin). */
export async function sheetState(ctx: Ctx): Promise<SheetState> {
  const mode = importMode();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") {
    const jar = await readMock();
    return { mode: "ok", test: true, access: { modes: [{ mode: "anyone_with_link", available: true, service_account_email: null }, { mode: "published_csv", available: true, service_account_email: null }, { mode: "service_account", available: false, service_account_email: null }] }, links: jar.links.map(asLink) };
  }
  try {
    const [access, links] = await Promise.all([getSheetAccess(ctx.token, ctx.tenantId), listSheetLinks(ctx.token, ctx.tenantId)]);
    return { mode: "ok", test: false, access, links };
  } catch (error) {
    leadFailure(error);
    return { mode: "unavailable" };
  }
}

export async function makeSheetLink(ctx: Ctx, body: SheetLinkBody, now: Date = new Date()): Promise<Out<SheetLink>> {
  const mode = importMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, data: await createSheetLink(ctx.token, ctx.tenantId, body) };
    } catch (error) {
      return leadFailure(error);
    }
  }
  if (!mappingHasContact(body.mapping)) return { ok: false, error: "mapping_required_missing" };
  if (/private/i.test(body.sheet_url)) return { ok: false, error: "sheet_not_public" };
  const jar = await readMock();
  const existing = jar.links.find((l) => l.id === body.link_id);
  if (existing) return { ok: true, data: asLink(existing) };
  if (jar.links.length >= 3) return { ok: false, error: "too_many" };
  const link: MockLink = { id: body.link_id, status: "active", at: null, rows: null, created: now.toISOString() };
  if (!(await saveMock({ ...jar, links: [link, ...jar.links] }))) return { ok: false, error: "too_many" };
  return { ok: true, data: asLink(link) };
}

export async function actOnLink(ctx: Ctx, id: string, what: "sync" | "pause" | "resume", now: Date = new Date()): Promise<Out<SheetLink>> {
  const mode = importMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, data: await actOnSheetLink(ctx.token, ctx.tenantId, id, what) };
    } catch (error) {
      return leadFailure(error);
    }
  }
  const jar = await readMock();
  const link = jar.links.find((l) => l.id === id);
  if (!link) return { ok: false, error: "not_available" };
  if (what === "sync") Object.assign(link, { at: now.toISOString(), rows: SAMPLE_ROWS, status: link.status === "paused" ? "paused" : "active" });
  else link.status = what === "pause" ? "paused" : "active";
  if (!(await saveMock(jar))) return { ok: false, error: "too_many" };
  return { ok: true, data: asLink(link) };
}
