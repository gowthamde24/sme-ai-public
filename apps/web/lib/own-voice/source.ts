import { cookies } from "next/headers";

import { createOwnVoice, deleteOwnVoice, getConsentSentence, getOwnVoice, type OwnVoiceIn } from "@/lib/api/own-voice";
import { ApiRequestError } from "@/lib/api/client";
import { ownVoiceScreens } from "@/lib/screens/flag";

import { CONSENT_SECONDS, SAMPLE_SECONDS, consentSentence, validConsentName, type OwnVoice } from "./types";

/**
 * Where the own-voice card gets its status and its moves (job DP). `mock` = ONE small cookie (the status, the name that consented and the time: never a recording, which the fake does not keep); `on` = C1's API
 * (lib/api/own-voice.ts); `off` = the card is not there. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_ownvoice_mock";
export type Ctx = { token: string; tenantId: string };
const NONE: OwnVoice = { status: "none", consentingName: null, consentedAt: null, sampleSeconds: null, consentSeconds: null, readyAt: null, deletedAt: null, saysAiAssistant: true, fake: true };

async function readMock(): Promise<OwnVoice> {
  try {
    const v: unknown = JSON.parse((await cookies()).get(MOCK_COOKIE)?.value ?? "null");
    if (!Array.isArray(v) || v[0] !== "ready" || typeof v[1] !== "string" || !validConsentName(v[1]) || typeof v[2] !== "string" || Number.isNaN(Date.parse(v[2]))) return NONE;
    return { ...NONE, status: "ready", consentingName: v[1], consentedAt: v[2], readyAt: v[2], sampleSeconds: Number(v[3]) || null, consentSeconds: Number(v[4]) || null };
  } catch {
    return NONE;
  }
}

export async function readOwnVoice(ctx: Ctx): Promise<{ mode: "off" } | { mode: "unavailable" } | { mode: "ok"; voice: OwnVoice }> {
  const mode = ownVoiceScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", voice: await readMock() };
  try {
    return { mode: "ok", voice: await getOwnVoice(ctx.token, ctx.tenantId) };
  } catch {
    return { mode: "unavailable" };
  }
}

export async function sentenceFor(ctx: Ctx, name: string, business: string): Promise<string | null> {
  if (!validConsentName(name)) return null;
  const mode = ownVoiceScreens();
  if (mode === "off") return null;
  if (mode === "mock") return consentSentence(name, business);
  try {
    return await getConsentSentence(ctx.token, ctx.tenantId, name);
  } catch {
    return null;
  }
}

export type MoveResult = { ok: true; voice: OwnVoice } | { ok: false; code: string; mfa?: boolean };
const refused = (error: unknown): MoveResult => ({ ok: false, code: error instanceof ApiRequestError ? error.code : "unavailable", ...(error instanceof ApiRequestError && error.code === "mfa_required" ? { mfa: true } : {}) });

export async function make(ctx: Ctx, body: OwnVoiceIn, business: string): Promise<MoveResult> {
  const mode = ownVoiceScreens();
  if (mode === "off") return { ok: false, code: "not_available" };
  if (mode === "mock") {
    if (!validConsentName(body.name) || body.consent_sentence !== consentSentence(body.name, business)) return { ok: false, code: "consent_sentence_mismatch" };
    if (!(body.sample_seconds >= SAMPLE_SECONDS.min && body.sample_seconds <= SAMPLE_SECONDS.max) || !(body.consent_seconds >= CONSENT_SECONDS.min && body.consent_seconds <= CONSENT_SECONDS.max)) return { ok: false, code: "recording_implausible_length" };
    if (!body.sample_base64 || !body.consent_base64) return { ok: false, code: "recording_missing" };
    if ((await readMock()).status === "ready") return { ok: false, code: "voice_exists" };
    const at = new Date().toISOString();
    (await cookies()).set(MOCK_COOKIE, JSON.stringify(["ready", body.name.trim(), at, Math.round(body.sample_seconds), Math.round(body.consent_seconds)]), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
    return { ok: true, voice: await readMock() };
  }
  try {
    return { ok: true, voice: await createOwnVoice(ctx.token, ctx.tenantId, body) };
  } catch (error) {
    return refused(error);
  }
}

export async function remove(ctx: Ctx): Promise<MoveResult> {
  const mode = ownVoiceScreens();
  if (mode === "off") return { ok: false, code: "not_available" };
  if (mode === "mock") {
    (await cookies()).delete(MOCK_COOKIE);
    return { ok: true, voice: { ...NONE, status: "deleted", deletedAt: new Date().toISOString() } };
  }
  try {
    return { ok: true, voice: await deleteOwnVoice(ctx.token, ctx.tenantId) };
  } catch (error) {
    return refused(error);
  }
}
