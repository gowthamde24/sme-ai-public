import { cookies } from "next/headers";

import { HELPERS, getAiTeamDay, getAiTeamPanel, getStandup, getStandupAudio, isDate, makeStandup, parseDay, parsePanel, parseStandup, putHelperSwitch, type AiTeamDay, type AiTeamPanel, type Helper, type Standup } from "@/lib/api/ai-team";
import { aiTeamDayFixture, aiTeamPanelFixture, standupFixture } from "@/lib/api/ai-team-fixtures";
import { getLang } from "@/i18n/get-lang";
import { fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";
import { aiTeamScreens } from "@/lib/screens/flag";
import { mockSampleWav } from "@/lib/voice-samples/mock";

/**
 * My AI team v2's data, on the server (the person's token never reaches the browser): the API (AI_TEAM_SCREENS=1) or the made-up day (=mock: lib/api/ai-team-fixtures.ts, read through the same parsers, the switches kept in a cookie of
 * this browser; nothing is sent anywhere). The page, its polling route, the panel route, the stand-up's sound and the actions all read here.
 */
export type TeamMode = "on" | "mock";
export type TeamCtx = { token: string; tenantId: string; mode: TeamMode; role: string; lang: string };

export const MOCK_COOKIE = "sme_aiteam_mock";
const MOCK_MAX_AGE = 60 * 60 * 24 * 7;
const DAY_MS = 86_400_000;

/** Today's date in India (the business's day). */
export const todayIndia = (now: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
/** A day the page may show: today, or up to 31 days back (the API's own limit); anything else is today. */
export function dayOrToday(v: string | null | undefined, now: Date = new Date()): string {
  const today = todayIndia(now);
  if (!v || !isDate(v) || v > today) return today;
  const back = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${v}T00:00:00Z`)) / DAY_MS;
  return back <= 31 ? v : today;
}

type MockState = { paused: Helper[]; made: Record<string, number> };
async function mockState(): Promise<MockState> {
  try {
    const raw = JSON.parse((await cookies()).get(MOCK_COOKIE)?.value ?? "{}") as Partial<MockState>;
    return { paused: Array.isArray(raw.paused) ? raw.paused.filter((h): h is Helper => (HELPERS as readonly unknown[]).includes(h)) : [], made: typeof raw.made === "object" && raw.made !== null ? raw.made : {} };
  } catch {
    return { paused: [], made: {} };
  }
}
async function saveMock(state: MockState): Promise<void> {
  (await cookies()).set(MOCK_COOKIE, JSON.stringify(state), { path: "/", httpOnly: true, sameSite: "lax", maxAge: MOCK_MAX_AGE, secure: process.env.NODE_ENV === "production" });
}
async function isSchool(ctx: TeamCtx): Promise<boolean> {
  return (await readPackCached(ctx.token, ctx.tenantId))?.modules.includes("programmes") === true;
}
/** India clock "HH:MM" now (the made-up day's "now"). */
const clockIndia = (now: Date = new Date()): string => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);

export async function readDay(ctx: TeamCtx, date: string): Promise<AiTeamDay> {
  if (ctx.mode === "on") return getAiTeamDay(ctx.token, ctx.tenantId, date);
  const today = todayIndia();
  const past = date < today;
  const clock = clockIndia();
  // the made-up day has its marks by 14:12; before that hour the picture would be empty, so the made-up "now" is never earlier
  const day = parseDay(aiTeamDayFixture({ school: await isSchool(ctx), date, now: clock < "14:12" ? "14:12" : clock, paused: (await mockState()).paused, past }));
  return ctx.role === "owner" || ctx.role === "admin" ? day : { ...day, costToday: null };
}

export async function readPanel(ctx: TeamCtx, helper: Helper): Promise<AiTeamPanel | null> {
  if (ctx.mode === "on") return getAiTeamPanel(ctx.token, ctx.tenantId, helper);
  const raw = aiTeamPanelFixture({ helper, tenantId: ctx.tenantId, school: await isSchool(ctx), date: todayIndia(), role: ctx.role, paused: (await mockState()).paused });
  return raw ? parsePanel(raw) : null;
}

export async function setSwitch(ctx: TeamCtx, helper: Helper, enabled: boolean): Promise<boolean> {
  if (ctx.mode === "on") return (await putHelperSwitch(ctx.token, ctx.tenantId, helper, enabled)).enabled;
  const state = await mockState();
  const paused = new Set(state.paused);
  if (enabled) paused.delete(helper);
  else paused.add(helper);
  await saveMock({ ...state, paused: [...paused] });
  return enabled;
}

export async function readStandup(ctx: TeamCtx, date: string): Promise<Standup | null> {
  if (ctx.mode === "on") return getStandup(ctx.token, ctx.tenantId, date, ctx.lang);
  const made = (await mockState()).made[date] ?? 0;
  // the example stand-up has no sound: a tone that says nothing is not a stand-up, so the page offers none (owner, 9 Nov 2026)
  return parseStandup({ ...standupFixture({ date, language: ctx.lang, leftToday: Math.max(0, 3 - made), school: await isSchool(ctx) }), audio: null, audio_reason: "unavailable" });
}

/** "Make it again" (at most 3 a day; the API answers 429 standup_limit after that, the made-up one too). */
export async function remakeStandup(ctx: TeamCtx, date: string): Promise<Standup | "limit"> {
  if (ctx.mode === "on") return makeStandup(ctx.token, ctx.tenantId, date, ctx.lang);
  const state = await mockState();
  const made = state.made[date] ?? 0;
  if (made >= 3) return "limit";
  await saveMock({ ...state, made: { [date]: made + 1 } });
  return parseStandup({ ...standupFixture({ date, language: ctx.lang, by: "owner", leftToday: 2 - made, school: await isSchool(ctx) }), audio: null, audio_reason: "unavailable" });
}

/** The stand-up's sound: the API's WAV, or in mock mode a short tone (it says nothing: the words are the transcript). */
export async function readStandupAudio(ctx: TeamCtx, date: string): Promise<{ bytes: ArrayBuffer | Uint8Array; contentType: string }> {
  if (ctx.mode === "on") return getStandupAudio(ctx.token, ctx.tenantId, date, ctx.lang);
  return { bytes: mockSampleWav({ voice: "female_warm", lang: "en", tone: "warm", name: "Stand-up" }), contentType: "audio/wav" };
}

/** The signed-in person's context for My AI team v2, or null when the v2 page is off (AI_TEAM_SCREENS unset). Rejected sessions throw ApiAuthError (the caller answers 401 or sends to sign in). */
export async function teamContext(tenantId: string): Promise<TeamCtx | null> {
  const mode = aiTeamScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return null;
  const user = await requireUser();
  const role = (await fetchTenant(user.accessToken, tenantId)).role;
  return { token: user.accessToken, tenantId, mode, role, lang: await getLang() };
}
