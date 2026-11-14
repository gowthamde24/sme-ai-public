import { redirect } from "next/navigation";

import { ApiAuthError } from "@/lib/api/client";
import { getTalkTraining } from "@/lib/api/talk-training";
import { getWorkspaceProfile } from "@/lib/api/workspace";
import { readAutoReply } from "@/lib/auto-reply/source";
import { readCallSettings } from "@/lib/call-settings/source";
import { apiFor } from "@/lib/context/server";
import { readKnowledge } from "@/lib/lead-desk/knowledge-source";
import { readOpeningLine } from "@/lib/opening-line/source";
import { aboutBusinessScreens, autoReplyScreens, callScreens, callLimitScreens, callSettingsScreens, leadsScreens, openingLineScreens, ownerTalkPrefs, talkTrainingScreens, voicePickerScreens } from "@/lib/screens/flag";
import { readTakeOver } from "@/lib/take-over/source";
import { readLimit } from "@/lib/call-limit/source";
import { readTalkPrefs } from "@/lib/talk-prefs/source";
import { TALK_LANGS, isTalkLang, type TalkLang } from "@/lib/talk-prefs/types";
import { readSpeaks } from "@/lib/talk-training/speaks-source";
import { readVoicePicker } from "@/lib/voice-picker/source";
import { LIVE_LANGS, pickerOrder, type PickerLang } from "@/lib/voice-picker/types";

import { readFacts } from "../ai-team/training/speaks-facts";

/**
 * What each tab of My assistant reads (owner, 13 Nov 2026). Only the OPEN tab's reads are made (each tab is its own address), and each read is the one Settings > AI assistant and Train how it talks already make, so a part that is switched off (its flag) or cannot be read is `null` and the tab says
 * so in plain words. An expired sign-in goes to sign in; anything else is a null part, never a broken page. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string; userId: string; modules: readonly string[] | null };

const soft = <T>(e: unknown): T | null => {
  if (e instanceof ApiAuthError) redirect("/login");
  return null;
};

export async function readKnowledgeTab(c: Ctx) {
  const aboutApi = apiFor(aboutBusinessScreens(), c.token, c.tenantId);
  const [about, knowledge] = await Promise.all([aboutApi ? aboutApi.get().catch((e) => soft<never>(e)) : Promise.resolve(null), leadsScreens() === "off" ? Promise.resolve(null) : readKnowledge({ token: c.token, tenantId: c.tenantId }).catch((e) => soft<never>(e))]);
  return { about: about && about.ok ? about.data : null, knowledge };
}

export async function readRulesTab(c: Ctx) {
  const ctx = { token: c.token, tenantId: c.tenantId };
  const [autoReply, takeOver, callSettings, callLimit] = await Promise.all([
    autoReplyScreens() === "off" ? null : readAutoReply(ctx).catch((e) => soft<never>(e)),
    callScreens() === "off" ? null : readTakeOver(ctx).catch((e) => soft<never>(e)),
    callSettingsScreens() === "off" ? null : readCallSettings(ctx, c.modules).catch((e) => soft<never>(e)),
    callLimitScreens() === "off" ? null : readLimit(c.token, c.tenantId).catch((e) => soft<never>(e)),
  ]);
  return { autoReply, takeOver, callSettings, callLimit };
}

export async function readVoiceTab(c: Ctx) {
  const ctx = { token: c.token, tenantId: c.tenantId };
  const picker = voicePickerScreens() === "off" ? null : await readVoicePicker(ctx).catch((e) => soft<never>(e));
  // the languages of the cards: the four the phone voice is offered in (owner, 9 Nov), the business's own first
  const own = picker?.mode === "ok" ? await getWorkspaceProfile(c.token, c.tenantId).then((p) => p.languages, (e) => soft<string[]>(e) ?? []) : [];
  const languages: PickerLang[] = pickerOrder(own).filter((l) => (LIVE_LANGS as readonly string[]).includes(l));
  // How your assistant speaks and the greeting: Talk training (the API exists; TALK_TRAINING_SCREENS)
  const training = talkTrainingScreens() ? await getTalkTraining(c.token, c.tenantId).catch((e) => soft<never>(e)) : null;
  const speaksRead = training ? await readSpeaks(ctx, await readFacts(c.token, c.tenantId, c.userId).catch((e) => soft<never>(e) ?? { legacyAddress: null, packDefault: "friendly" as const, ownerName: null })) : null;
  const opening = training && openingLineScreens() !== "off" ? await readOpeningLine(ctx).catch((e) => soft<never>(e)) : null;
  // "How it talks to you" (owner item G): the person's own choices, in the business's own language first (the first one that is not English, as the composer does)
  let talk: { prefs: Awaited<ReturnType<typeof readTalkPrefs>> & { mode: "ok" }; languages: TalkLang[]; first: TalkLang } | null = null;
  if (ownerTalkPrefs() !== "off") {
    const profile = own.length ? own : await getWorkspaceProfile(c.token, c.tenantId).then((p) => p.languages, (e) => soft<string[]>(e) ?? []);
    const talkLangs: TalkLang[] = [...new Set([...profile.filter(isTalkLang), ...TALK_LANGS])].filter((l) => profile.length === 0 || profile.includes(l) || l === "en");
    const first: TalkLang = talkLangs.find((l) => l !== "en") ?? "en";
    const prefs = await readTalkPrefs(c.token, first).catch((e) => soft<never>(e));
    talk = prefs?.mode === "ok" ? { prefs, languages: talkLangs, first } : null;
  }
  return { talk, picker: picker?.mode === "ok" ? picker.data : null, languages, training, speaks: speaksRead?.mode === "ok" ? { initial: speaksRead.data, demo: speaksRead.demo } : null, opening: opening?.mode === "ok" ? opening.data : null };
}
