import type { NextRequest } from "next/server";

import { fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { make } from "@/lib/own-voice/source";
import { AUDIO_TYPES, CONSENT_MAX_BYTES, SAMPLE_MAX_BYTES, validConsentName } from "@/lib/own-voice/types";
import { ownVoiceScreens } from "@/lib/screens/flag";

import { guard, json, NO_STORE } from "../data/route-kit";

export const dynamic = "force-dynamic";

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const b64Bytes = (s: string): number => Math.floor((s.length * 3) / 4);
const STATUS: Record<string, number> = { mfa_required: 403, voice_exists: 409, recording_too_large: 413, voice_provider_refused: 502, voice_provider_unreachable: 502, unavailable: 503, not_available: 404 };

/**
 * POST /app/tenants/[tenantId]/own-voice (job DP): the Owner's own voice, with consent (C1's contract-own-voice.md). The browser never holds the token, so the two recordings (base64 inside one JSON body, as the API takes
 * them) come here and go on with the person's own token. Only the Owner (the API needs the second factor too). Every field is checked before anything is sent; nothing is kept here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const guarded = await guard(request, params);
  if (guarded instanceof Response) return guarded;
  const { user, tenantId } = guarded;
  if (ownVoiceScreens() === "off" || !isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404, headers: NO_STORE });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 18 * 1024 * 1024) return json({ ok: false, code: "recording_too_large" }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response("Bad request", { status: 400, headers: NO_STORE });
  }
  const { id, name, consent_sentence: sentence, sample_base64: sample, sample_type: sampleType, sample_seconds: sampleSeconds, consent_base64: consent, consent_type: consentType, consent_seconds: consentSeconds } = body;
  const type = (t: unknown) => typeof t === "string" && (AUDIO_TYPES as readonly string[]).includes(t.split(";")[0]);
  if (typeof id !== "string" || !isCanonicalUuid(id) || !validConsentName(name) || typeof sentence !== "string" || sentence.length > 400) return new Response("Bad request", { status: 400, headers: NO_STORE });
  if (typeof sample !== "string" || typeof consent !== "string" || !B64.test(sample) || !B64.test(consent)) return json({ ok: false, code: "recording_not_base64" }, 422);
  if (b64Bytes(sample) > SAMPLE_MAX_BYTES || b64Bytes(consent) > CONSENT_MAX_BYTES) return json({ ok: false, code: "recording_too_large" }, 413);
  if (!type(sampleType) || !type(consentType) || typeof sampleSeconds !== "number" || typeof consentSeconds !== "number" || !Number.isFinite(sampleSeconds) || !Number.isFinite(consentSeconds)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  let business = "";
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner") return json({ ok: false, code: "forbidden" }, 403);
    business = tenant.name;
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
  const out = await make(
    { token: user.accessToken, tenantId },
    { id, name: name.trim(), consent_sentence: sentence, sample_base64: sample, sample_type: sampleType as string, sample_seconds: sampleSeconds, consent_base64: consent, consent_type: consentType as string, consent_seconds: consentSeconds },
    business,
  );
  return out.ok ? json({ ok: true, data: out.voice }) : json({ ok: false, code: out.code, ...(out.mfa ? { mfa: true } : {}) }, STATUS[out.code] ?? 422);
}
