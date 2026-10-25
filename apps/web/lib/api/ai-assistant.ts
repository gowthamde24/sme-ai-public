import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant/name";
import { DAYS, parseSettings, type AssistantSettings } from "@/lib/assistant/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Settings > AI assistant from C1's API (job DO; docs/contracts/assistant-settings.md). `GET /v1/tenants/{id}/ai-assistant` (Owner, Admin) and `PUT` (Owner, with the second factor). The API is snake_case and owns the defaults of
 * each business type; the screen's own shape (lib/assistant/types.ts) is the one it was built on, so these two functions are the whole mapping, one line per field: hours are minutes after midnight there and "HH:MM" here, days
 * are 1 (Monday) to 7 (Sunday) there and mon..sun here, "AI assistant" is never part of the name, and the highest order the assistant takes alone is in paise there and whole rupees here. Every answer is checked by `parseSettings`.
 */
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const STYLE_FROM_API: Record<string, string> = { warm: "warm", respectful: "resp", quick: "quick" };
const STYLE_TO_API: Record<string, string> = { warm: "warm", resp: "respectful", quick: "quick" };
const clock = (minute: unknown): string | null => {
  if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};
const minuteOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** One `AssistantSettings` of the API as the screen's settings, or null when any part is not in its shape. */
export function fromApiSettings(s: unknown): AssistantSettings | null {
  if (!isRecord(s) || !Array.isArray(s.call_days)) return null;
  const days = s.call_days.map((d) => (typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7 ? DAYS[d - 1] : null));
  const from = clock(s.call_from_minute);
  const to = clock(s.call_to_minute);
  const order = s.handover_order_above_paise;
  if (days.includes(null) || from === null || to === null) return null;
  if (!(order === null || (typeof order === "number" && Number.isInteger(order) && order >= 0 && order % 100 === 0))) return null;
  return parseSettings({
    name: s.name,
    voice: s.voice_persona,
    lang: s.main_language,
    autoSwitch: s.auto_switch_language,
    mixEnglish: s.allow_english_mixing,
    style: typeof s.style === "string" ? STYLE_FROM_API[s.style] : undefined,
    speed: s.speed,
    may: { prices: s.may_answer_prices, visits: s.may_book_visits, whatsapp: s.may_send_media, dues: s.may_talk_dues },
    maxDiscount: s.max_discount_percent,
    handover: { owner: s.handover_owner_asked, upset: s.handover_upset, orderAbove: order === null ? null : order / 100 },
    hours: { from, to, days },
  });
}

/** The screen's settings as the API's body (every field, always). */
export function toApiSettings(s: AssistantSettings): Record<string, unknown> {
  return {
    name: s.name,
    voice_persona: s.voice,
    main_language: s.lang,
    auto_switch_language: s.autoSwitch,
    allow_english_mixing: s.mixEnglish,
    style: STYLE_TO_API[s.style],
    speed: s.speed,
    may_answer_prices: s.may.prices,
    may_book_visits: s.may.visits,
    may_send_media: s.may.whatsapp,
    may_talk_dues: s.may.dues,
    max_discount_percent: s.maxDiscount,
    handover_owner_asked: s.handover.owner,
    handover_upset: s.handover.upset,
    handover_order_above_paise: s.handover.orderAbove === null ? null : s.handover.orderAbove * 100,
    call_days: DAYS.map((d, i) => (s.hours.days.includes(d) ? i + 1 : 0)).filter((n) => n > 0),
    call_from_minute: minuteOf(s.hours.from),
    call_to_minute: minuteOf(s.hours.to),
  };
}

export type AssistantFromApi = { settings: AssistantSettings; saved: boolean };

/**
 * What the screen needs of `AssistantOut`: the settings (the business type's defaults before the first save) and whether the owner has saved. Before a save the name is OUR default (lib/assistant/name.ts), not the API's sample
 * name: the owner decided what the assistant is called until somebody chooses.
 */
export function parseAiAssistant(json: unknown): AssistantFromApi {
  if (!isRecord(json) || typeof json.saved !== "boolean") throw new ApiContractError("Unexpected AI assistant response.");
  const settings = fromApiSettings(json.settings);
  if (!settings) throw new ApiContractError("Unexpected AI assistant settings.");
  return { settings: json.saved ? settings : { ...settings, name: DEFAULT_ASSISTANT_NAME }, saved: json.saved };
}

export async function getAiAssistant(accessToken: string, tenantId: string): Promise<AssistantFromApi> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return parseAiAssistant(await apiRequest(`/v1/tenants/${tenantId}/ai-assistant`, accessToken));
}

/** `PUT`: the Owner, second factor (403 `mfa_required` otherwise); 422 for a bad value. */
export async function putAiAssistant(accessToken: string, tenantId: string, settings: AssistantSettings): Promise<void> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  await apiRequest(`/v1/tenants/${tenantId}/ai-assistant`, accessToken, { method: "PUT", body: JSON.stringify(toApiSettings(settings)) });
}
