import { randomUUID } from "node:crypto";

import { createSource, discardUnparsed, listSources, listUnparsed, pullIndiaMart, rotateSource, setSourceStatus } from "@/lib/api/lead-sources";
import { readJar, writeJar } from "@/lib/mock/jar";
import { leadsScreens } from "@/lib/screens/flag";

import { leadFailure } from "../failure";
import { asLiveSource, fakeSecret, tagFor, type MockSource } from "./mock";
import { SOURCE_KINDS, type LiveSource, type Out, type PullResult, type SourceCreateBody, type SourcesRead, type SourceWithSecret, type Unparsed } from "./types";

/**
 * Where the lead sources come from and go (night 4, Lead Desk, item 4). `mock` = test mode: ONE cookie holds a few made-up sources and mails (checked on every read); the secret is made fresh and handed over once, never
 * kept; `on` = C1's API (lib/api/lead-sources.ts); `off` = the parts are not there. SERVER ONLY. The role (Owner, Admin) is checked by the caller.
 */
export const sourcesMode = leadsScreens;
export const MOCK_COOKIE = "sme_leadsources_mock";
export type Ctx = { token: string; tenantId: string };
type MockMail = { id: string; source: string; at: string; subject: string };
type Jar = { sources: MockSource[]; mail: MockMail[] };

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function parseJar(v: unknown): Jar | null {
  if (!rec(v) || !Array.isArray(v.sources) || !Array.isArray(v.mail)) return null;
  const sources: MockSource[] = [];
  for (const s of v.sources.slice(0, 8)) {
    if (!rec(s) || typeof s.id !== "string" || typeof s.label !== "string" || typeof s.at !== "string" || typeof s.hint !== "string") continue;
    if (!(SOURCE_KINDS as readonly unknown[]).includes(s.kind) || typeof s.tag !== "string" || (s.status !== "active" && s.status !== "paused")) continue;
    sources.push({ id: s.id, kind: s.kind as MockSource["kind"], tag: s.tag as MockSource["tag"], label: s.label.slice(0, 80), status: s.status, at: s.at, hint: s.hint.slice(0, 8), cost: typeof s.cost === "number" ? s.cost : null, consent: s.consent === true });
  }
  const mail: MockMail[] = [];
  for (const m of v.mail.slice(0, 6)) if (rec(m) && typeof m.id === "string" && typeof m.source === "string" && typeof m.at === "string" && typeof m.subject === "string") mail.push({ id: m.id, source: m.source, at: m.at, subject: m.subject.slice(0, 80) });
  return { sources, mail };
}
const EMPTY: Jar = { sources: [], mail: [] };
const readMock = (): Promise<Jar> => readJar(MOCK_COOKIE, parseJar, EMPTY);
const MAX_MOCK = 6;

export async function readSources(ctx: Ctx, now: Date = new Date()): Promise<SourcesRead> {
  const mode = sourcesMode();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") {
    const jar = await readMock();
    return { mode: "ok", test: true, sources: jar.sources.map((s) => asLiveSource(s, now)), unparsed: jar.mail.map((m) => ({ id: m.id, source_id: m.source, received_at: m.at, subject: m.subject, preview: "Hello, I saw your ad and want to know the price. (test mail)" })) };
  }
  try {
    const [sources, unparsed] = await Promise.all([listSources(ctx.token, ctx.tenantId), listUnparsed(ctx.token, ctx.tenantId).catch((error) => (leadFailure(error), [] as Unparsed[]))]);
    return { mode: "ok", test: false, sources, unparsed };
  } catch (error) {
    leadFailure(error);
    return { mode: "unavailable" };
  }
}

export async function createSourceStep(ctx: Ctx, body: SourceCreateBody, now: Date = new Date()): Promise<Out<SourceWithSecret>> {
  const mode = sourcesMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, data: await createSource(ctx.token, ctx.tenantId, body) };
    } catch (error) {
      return leadFailure(error);
    }
  }
  const jar = await readMock();
  const same = jar.sources.find((s) => s.id === body.source_id);
  if (same) return { ok: true, data: { ...asLiveSource(same, now), secret: null } };
  if (jar.sources.length >= MAX_MOCK) return { ok: false, error: "too_many" };
  const made = fakeSecret(body.kind);
  const source: MockSource = { id: body.source_id, kind: body.kind, tag: tagFor(body), label: body.label, status: "active", at: now.toISOString(), hint: made.hint, cost: body.cost_per_lead_paise, consent: body.consent !== null };
  const mail: MockMail[] = body.kind === "email_forward" ? [{ id: randomUUID(), source: source.id, at: now.toISOString(), subject: "Fwd: New enquiry (test mail)" }, ...jar.mail].slice(0, 4) : jar.mail;
  if (!(await writeJar(MOCK_COOKIE, { sources: [source, ...jar.sources], mail }))) return { ok: false, error: "too_many" };
  return { ok: true, data: { ...asLiveSource(source, now), secret: made.secret } };
}

export async function rotateStep(ctx: Ctx, id: string, now: Date = new Date()): Promise<Out<SourceWithSecret>> {
  const mode = sourcesMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, data: await rotateSource(ctx.token, ctx.tenantId, id) };
    } catch (error) {
      return leadFailure(error);
    }
  }
  const jar = await readMock();
  const source = jar.sources.find((s) => s.id === id);
  if (!source) return { ok: false, error: "not_available" };
  const made = fakeSecret(source.kind);
  source.hint = made.hint;
  if (!(await writeJar(MOCK_COOKIE, jar))) return { ok: false, error: "too_many" };
  return { ok: true, data: { ...asLiveSource(source, now), secret: made.secret } };
}

export async function statusStep(ctx: Ctx, id: string, what: "pause" | "resume", now: Date = new Date()): Promise<Out<LiveSource>> {
  const mode = sourcesMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, data: await setSourceStatus(ctx.token, ctx.tenantId, id, what) };
    } catch (error) {
      return leadFailure(error);
    }
  }
  const jar = await readMock();
  const source = jar.sources.find((s) => s.id === id);
  if (!source) return { ok: false, error: "not_available" };
  source.status = what === "pause" ? "paused" : "active";
  if (!(await writeJar(MOCK_COOKIE, jar))) return { ok: false, error: "too_many" };
  return { ok: true, data: asLiveSource(source, now) };
}

export async function pullStep(ctx: Ctx, now: Date = new Date()): Promise<Out<PullResult>> {
  const mode = sourcesMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, data: await pullIndiaMart(ctx.token, ctx.tenantId) };
    } catch (error) {
      return leadFailure(error);
    }
  }
  const jar = await readMock();
  if (!jar.sources.some((s) => s.kind === "indiamart")) return { ok: false, error: "connector_not_available" };
  return { ok: true, data: { fetched: 4, created: 3, merged: 1, invalid: 0, existing: 0, window_start: new Date(now.getTime() - 86_400_000).toISOString(), window_end: now.toISOString() } };
}

export async function discardStep(ctx: Ctx, id: string): Promise<Out<null>> {
  const mode = sourcesMode();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      await discardUnparsed(ctx.token, ctx.tenantId, id);
      return { ok: true, data: null };
    } catch (error) {
      return leadFailure(error);
    }
  }
  const jar = await readMock();
  if (!(await writeJar(MOCK_COOKIE, { ...jar, mail: jar.mail.filter((m) => m.id !== id) }))) return { ok: false, error: "too_many" };
  return { ok: true, data: null };
}
