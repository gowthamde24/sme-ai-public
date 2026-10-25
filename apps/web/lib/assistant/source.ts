import { cookies } from "next/headers";

import { assistantScreens } from "@/lib/screens/flag";

import { assistantProfile, enforceProfile } from "./defaults";
import { parseSettings, type AssistantSettings } from "./types";

/**
 * Where Settings > AI assistant gets the assistant's settings from and where a save goes (job DM). `mock` = ONE cookie of the browser (httpOnly, checked by `parseSettings` on every read: a cookie that is not in the shape is ignored and
 * the defaults of the business type are used); `on` = C1's API, not published yet, so the screen says "Not available yet"; `off` = the part is not there. Nothing is sent to a server in mock mode. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_assistant_mock";
export type AssistantRead = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; settings: AssistantSettings; /** Whether the person has saved their own (else these are the defaults of the business type). */ saved: boolean };
export type SaveResult = { ok: true } | { ok: false; error: "not_available" | "invalid" };

export async function readAssistant(modules: readonly string[] | null | undefined): Promise<AssistantRead> {
  const mode = assistantScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") return { mode: "unavailable" };
  const raw = (await cookies()).get(MOCK_COOKIE)?.value;
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
 * The assistant's name for the workspace being drawn, or null (the default applies): the owner's own choice, only when the screens are on. For `mock` it is the cookie (checked like every read); for `on` it will be C1's setting,
 * which is not published yet. Never throws: a name must not stop a page from drawing.
 */
export async function readAssistantName(): Promise<string | null> {
  if (assistantScreens() !== "mock") return null;
  try {
    const raw = (await cookies()).get(MOCK_COOKIE)?.value;
    return raw ? (parseSettings(JSON.parse(raw))?.name ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveAssistant(input: unknown, modules: readonly string[] | null | undefined): Promise<SaveResult> {
  if (assistantScreens() !== "mock") return { ok: false, error: "not_available" };
  const settings = parseSettings(input);
  if (!settings) return { ok: false, error: "invalid" };
  (await cookies()).set(MOCK_COOKIE, JSON.stringify(enforceProfile(settings, assistantProfile(modules))), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return { ok: true };
}
