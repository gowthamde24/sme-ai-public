import { cookies } from "next/headers";

import { ApiRequestError } from "@/lib/api/client";
import { getHowSpeaks, putHowSpeaks } from "@/lib/api/how-speaks";
import { speaksPanelScreens } from "@/lib/screens/flag";

import { INTRODUCE_DEFAULT, type IntroduceAs } from "./introduce";
import { parseHowSpeaks, SPEAK_LANGS, speaksProblem, toneFromLegacy, type Background, type HowSpeaks, type LegacyAddress, type SpeakLang, type SpeakStyle, type SpeaksChange, type SpeakTone } from "./speaks";

/**
 * Where "How your assistant speaks" comes from and goes (job speaks-panel; C1's fixed contract docs/contracts/how-assistant-speaks.md). `mock` = ONE cookie of the browser, answered the way the contract says (the old "How to address customers" is mapped to a tone until the panel is saved;
 * the mock refuses what the API would refuse, with the same codes); `on` = C1's endpoint once it is built (PR #459 is the contract); `off` = the panel is not there. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_speaks_mock";
const COOKIE_MAX = 3000;
export type Ctx = { token: string; tenantId: string };
/** What the page knows that the mock needs (the real API knows it itself): the old address setting, the business type's usual tone, the Owner's first name. */
export type Facts = { legacyAddress: LegacyAddress | null; packDefault: SpeakTone; ownerName: string | null };
export type SpeaksRead = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; demo: boolean; data: HowSpeaks };

type Kept = { t?: SpeakTone; w?: Partial<Record<SpeakLang, { s?: SpeakStyle }>>; i?: { k: IntroduceAs["kind"]; x: string | null }; b?: Background; a?: boolean; u?: string; at?: string };

async function load(): Promise<Kept> {
  try {
    const raw = (await cookies()).get(MOCK_COOKIE)?.value;
    const v = raw ? (JSON.parse(raw) as Kept) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    // not JSON: the defaults are used
  }
  return {};
}

/** The words of the three background choices as the API sends them (the test mode answers with the same). */
const BACKGROUND_WORDS: Partial<Record<Background, Partial<Record<string, string>>>> = {
  quiet_office: { en: "Quiet office", te: "ప్రశాంతమైన ఆఫీస్", hi: "शांत ऑफिस", kn: "ಶಾಂತ ಆಫೀಸ್" },
  shop: { en: "Shop", te: "షాప్", hi: "दुकान", kn: "ಅಂಗಡಿ" },
  off: { en: "Off", te: "ఆఫ్", hi: "बंद", kn: "ಆಫ್" },
};

/** The object the contract describes, from what is kept and what the page knows. */
function build(k: Kept, f: Facts): HowSpeaks {
  const saved = k.t !== undefined;
  const migrated = !saved && (f.legacyAddress === "sir_madam" || f.legacyAddress === "garu" || f.legacyAddress === "ji");
  const words = {} as HowSpeaks["words"];
  for (const l of SPEAK_LANGS) {
    const own = k.w?.[l];
    words[l] = { style: own?.s ?? "everyday_mixed", saved: own !== undefined, examples: l === "te" ? "approved" : "draft" };
  }
  const ia = k.i ? { kind: k.i.k, text: k.i.x } : INTRODUCE_DEFAULT;
  return {
    tone: { value: saved ? (k.t as SpeakTone) : toneFromLegacy(f.legacyAddress, f.packDefault), source: saved ? "saved" : migrated ? "migrated" : "pack_default", packDefault: f.packDefault, options: [] },
    background: { value: k.b ?? "quiet_office", saved: k.b !== undefined, options: ((["quiet_office", "shop", "off"] as const).map((id) => ({ id, label: BACKGROUND_WORDS[id] ?? { en: id }, sampleUrl: null }))) },
    sayAi: { value: k.a ?? true, saved: k.a !== undefined, undertakingAt: k.a === false ? (k.u ?? null) : null }, // ON by default (lawyer's opinion, 25 Nov 2026)
    words,
    introduceAs: { ...ia, ownerName: f.ownerName },
    packDefaults: { tone: f.packDefault },
    legacyAddress: f.legacyAddress,
    updatedAt: k.at ?? null,
  };
}

export async function readSpeaks(ctx: Ctx, facts: Facts): Promise<SpeaksRead> {
  const mode = speaksPanelScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "on") {
    try {
      return { mode: "ok", demo: false, data: await getHowSpeaks(ctx.token, ctx.tenantId) };
    } catch {
      return { mode: "unavailable" };
    }
  }
  const data = parseHowSpeaks(wire(build(await load(), facts)));
  return data ? { mode: "ok", demo: true, data } : { mode: "unavailable" };
}

/** Save any subset (the Owner, second factor, is checked by the caller). The API's refusals are thrown (ApiRequestError); the mock throws the same ones. */
export async function saveSpeaks(ctx: Ctx, change: SpeaksChange, facts: Facts, now: number = Date.now()): Promise<HowSpeaks> {
  const mode = speaksPanelScreens();
  if (mode === "off") throw new ApiRequestError(404, "not_found", "Not found.");
  if (mode === "on") return putHowSpeaks(ctx.token, ctx.tenantId, change);
  if (speaksProblem(change) !== null) throw new ApiRequestError(422, "validation_error", "Invalid.");
  const k = await load();
  if (change.tone !== undefined) {
    if (change.tone === null) delete k.t;
    else k.t = change.tone;
  }
  if (change.words) {
    k.w = { ...(k.w ?? {}) };
    // (the languages are walked from the fixed list, never written under a name the browser sent: speaksProblem has already refused any other)
    for (const l of SPEAK_LANGS) {
      const v = change.words[l];
      if (v) k.w[l] = { ...(k.w[l] ?? {}), ...(v.style ? { s: v.style } : {}) };
    }
  }
  if (change.background !== undefined) {
    if (change.background === null) delete k.b;
    else k.b = change.background;
  }
  if (change.sayAi !== undefined) {
    if (change.sayAi === null) { delete k.a; delete k.u; }
    else if (change.sayAi === false) {
      if (change.sayAiUndertaking !== true) throw new ApiRequestError(422, "validation_error", "undertaking_required");
      k.a = false;
      k.u = new Date(now).toISOString();
    } else { k.a = true; delete k.u; }
  }
  if (change.introduceAs) {
    if (change.introduceAs.kind === "owner" && !facts.ownerName) throw new ApiRequestError(422, "validation_error", "no_owner_name"); // (the contract: with no first name in the profile, "My name" cannot be used)
    k.i = { k: change.introduceAs.kind, x: change.introduceAs.kind === "business" ? null : (change.introduceAs.text ?? "") };
  }
  k.at = new Date(now).toISOString();
  const text = JSON.stringify(k);
  if (text.length > COOKIE_MAX) throw new ApiRequestError(422, "validation_error", "Too much for the test mode.");
  (await cookies()).set(MOCK_COOKIE, text, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  const out = parseHowSpeaks(wire(build(k, facts)));
  if (!out) throw new ApiRequestError(422, "validation_error", "Invalid.");
  return out;
}

/** The mock goes through the contract's own parser, like the API's answer does. */
function wire(h: HowSpeaks): Record<string, unknown> {
  return {
    tone: { value: h.tone.value, source: h.tone.source, pack_default: h.tone.packDefault, options: ["friendly", "respectful", "quick"] },
    background: h.background ? { value: h.background.value, saved: h.background.saved, options: h.background.options.map((o) => ({ id: o.id, label: o.label })) } : undefined,
    say_ai_when_greeting: h.sayAi ?? undefined,
    words: { languages: Object.fromEntries(SPEAK_LANGS.map((l) => [l, { style: h.words[l].style, saved: h.words[l].saved, examples: h.words[l].examples }])), options: { styles: ["everyday_mixed", "everyday_pure"] } },
    introduce_as: { kind: h.introduceAs.kind, text: h.introduceAs.text, options: ["business", "owner", "custom"], owner_name: h.introduceAs.ownerName },
    pack_defaults: { tone: h.packDefaults.tone },
    legacy_address: h.legacyAddress,
    updated_at: h.updatedAt,
  };
}
