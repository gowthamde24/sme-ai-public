import { cookies } from "next/headers";
import { cache } from "react";

import { ApiRequestError } from "@/lib/api/client";
import { getAiAssistant, postTestCall, putAiAssistant, type AssistantFromApi } from "@/lib/api/ai-assistant";
import { assistantScreens } from "@/lib/screens/flag";

import { assistantProfile, enforceProfile } from "./defaults";
import { mockTestCall, type TestCallResult } from "./test-call";
import { parseSettings, type AssistantSettings } from "./types";

/**
 * Where Settings > AI assistant gets the assistant's settings from and where a save goes (jobs DM and DO). `mock` = ONE cookie of the browser (httpOnly, checked by `parseSettings` on every read: a cookie that is not in the shape is
 * ignored and the defaults of the business type are used; nothing is sent to a server); `on` = C1's API (lib/api/ai-assistant.ts: the API owns the defaults of each business type and the owner's saved choice); `off` = the part is
 * not there. A read that fails says "Not available yet" and never a guess. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_assistant_mock";
export type AssistantRead = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; settings: AssistantSettings; /** Whether the person has saved their own (else these are the defaults of the business type). */ saved: boolean };
export type SaveResult = { ok: true } | { ok: false; error: "not_available" | "invalid" | "mfa" };
export type CtxAssistant = { token: string; tenantId: string };

/** One read of the API per request: the settings page, the name for every word of the page and the save all use it. Outside a request (tests) it asks every time. */
const readApiCached = cache((token: string, tenantId: string): Promise<AssistantFromApi | null> => getAiAssistant(token, tenantId).catch(() => null));

export async function readAssistant(ctx: CtxAssistant, modules: readonly string[] | null | undefined): Promise<AssistantRead> {
  const mode = assistantScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") {
    const got = await readApiCached(ctx.token, ctx.tenantId);
    return got ? { mode: "ok", settings: enforceProfile(got.settings, assistantProfile(modules)), saved: got.saved } : { mode: "unavailable" };
  }
  let raw: string | undefined;
  try {
    raw = (await cookies()).get(MOCK_COOKIE)?.value;
  } catch {
    raw = undefined; // outside a request (a test): the defaults
  }
  if (raw) {
    try {
      const own = parseSettings(JSON.parse(raw));
      if (own) return { mode: "ok", settings: enforceProfile(own, assistantProfile(modules)), saved: true };
    } catch {
      // not JSON: ignored, the defaults are used
    }
  }
  return { mode: "ok", settings: assistantProfile(modules).defaults, saved: false };
}

/**
 * The assistant's name for the workspace being drawn, or null (the default applies): the owner's own saved choice, only when the screens are on. `mock`: the cookie (checked like every read). `on`: the API, when the person may read
 * it (Owner and Admin; for anyone else the default is said until the API gives the name to every member). Never throws: a name must not stop a page from drawing.
 */
export async function readAssistantName(ctx: CtxAssistant | null = null): Promise<string | null> {
  const mode = assistantScreens();
  try {
    if (mode === "on") {
      if (!ctx) return null;
      const got = await readApiCached(ctx.token, ctx.tenantId);
      return got?.saved ? got.settings.name : null;
    }
    if (mode !== "mock") return null;
    const raw = (await cookies()).get(MOCK_COOKIE)?.value;
    return raw ? (parseSettings(JSON.parse(raw))?.name ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveAssistant(ctx: CtxAssistant, input: unknown, modules: readonly string[] | null | undefined): Promise<SaveResult> {
  const mode = assistantScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  const settings = parseSettings(input);
  if (!settings) return { ok: false, error: "invalid" };
  const kept = enforceProfile(settings, assistantProfile(modules));
  if (mode === "on") {
    try {
      await putAiAssistant(ctx.token, ctx.tenantId, kept);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "mfa_required") return { ok: false, error: "mfa" };
      return { ok: false, error: error instanceof ApiRequestError && error.status === 422 ? "invalid" : "not_available" };
    }
  }
  (await cookies()).set(MOCK_COOKIE, JSON.stringify(kept), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return { ok: true };
}

/** The simulated test call (job DQ part 3): the Owner, second factor on the API. `mock` answers from the saved settings (or the defaults); no call is made in either mode. */
export async function testCall(ctx: CtxAssistant, shop: string, modules: readonly string[] | null | undefined): Promise<TestCallResult> {
  const mode = assistantScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      return { ok: true, call: await postTestCall(ctx.token, ctx.tenantId) };
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "mfa_required") return { ok: false, error: "mfa" };
      if (error instanceof ApiRequestError && error.code === "workspace_read_only") return { ok: false, error: "read_only" };
      return { ok: false, error: "not_available" };
    }
  }
  const read = await readAssistant(ctx, modules);
  return read.mode === "ok" ? { ok: true, call: mockTestCall(read.settings, shop) } : { ok: false, error: "not_available" };
}
