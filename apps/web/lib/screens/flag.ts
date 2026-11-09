/**
 * The feature flags of the three screens job DM adds before their API exists: the live call, the outcomes (after a call or a WhatsApp follow-up) and Settings > AI assistant. Each is read by the SERVER when it handles a request (not baked into
 * the bundle, like PLAN_SCREENS and lib/auth/signup-open.ts), so a Cloud Run environment variable is enough. Off by default: unset or anything else = off (the screen is not there). "mock" = on with FAKE data that lives in a cookie of the
 * browser (for review and the pictures: no network, nothing stored on a server). "on" = the API of that part, which C1 has not published yet (ADR 0092 and contract-outcomes.md): until it exists the screen says "Not available yet", never a guess.
 */
export type ScreenMode = "off" | "on" | "mock";

export function screenMode(value: string | undefined): ScreenMode {
  return value === "mock" ? "mock" : value === "1" ? "on" : "off";
}

export const callScreens = (value: string | undefined = process.env.CALL_SCREENS): ScreenMode => screenMode(value);
/** "Live now": what the assistant is doing at this moment (the pill in the top bar). `1` = the API, `mock` = made-up activity for demo workspaces only. */
export const activityScreens = (value: string | undefined = process.env.ACTIVITY_SCREENS): ScreenMode => screenMode(value);
export const outcomeScreens = (value: string | undefined = process.env.OUTCOME_SCREENS): ScreenMode => screenMode(value);
export const assistantScreens = (value: string | undefined = process.env.ASSISTANT_SCREENS): ScreenMode => screenMode(value);

/** Job DP: the three screens of the night run of 26 Oct, each behind its own flag because C1's APIs ship separately. `mock` = fake data kept in a cookie (nothing is sent), `1` = the API. */
export const callSettingsScreens = (value: string | undefined = process.env.CALL_SETTINGS_SCREENS): ScreenMode => screenMode(value);
export const ownVoiceScreens = (value: string | undefined = process.env.OWN_VOICE_SCREENS): ScreenMode => screenMode(value);
export const marksScreens = (value: string | undefined = process.env.MARKS_SCREENS): ScreenMode => screenMode(value);

/** Job DQ part 2 (DPDP): the settings that need C1's consent and grievance API (the marketing switch, "Raise a grievance", the marketing box of sign-up). `mock` = fake data kept in a cookie (nothing is sent), `1` = the API (contract-dpdp.md). The Privacy notice and its processor list do not depend on it: they are always there. */
export const dpdpScreens = (value: string | undefined = process.env.DPDP_SCREENS): ScreenMode => screenMode(value);

/** Job DQ part 3: the voice picker's samples ("Hear it" beside each voice, per language and tone). `mock` = a short synthetic sound made on the server (no network, no provider: it says which voice is which, not how it will sound), `1` = C1's sample files or preview endpoint through our own route. Off: the buttons are not drawn. */
/**
 * Night 4 (jobs DR and DS), "Lead Desk" and "Ask Vijaya to do it", each behind its own flag because C1's APIs ship separately. `mock` = fake data kept in a cookie (nothing is sent), `1` = the API, unset = the part is not there.
 * LEADS_SCREENS: the nine "any business with leads" types at sign-up, the setup wizard, the knowledge base and playbook, lead imports, lead sources, the Lead Desk list. OUTREACH_SCREENS: batch plans with "Approve all", standing rules,
 * hot-lead hand-offs and the lead report. TASK_SCREENS: "Ask Vijaya to do it". TOPUP_SCREENS: top-ups of minutes and messages in Settings > Plan.
 */
export const leadsScreens = (value: string | undefined = process.env.LEADS_SCREENS): ScreenMode => screenMode(value);
export const outreachScreens = (value: string | undefined = process.env.OUTREACH_SCREENS): ScreenMode => screenMode(value);
export const taskScreens = (value: string | undefined = process.env.TASK_SCREENS): ScreenMode => screenMode(value);
export const topupScreens = (value: string | undefined = process.env.TOPUP_SCREENS): ScreenMode => screenMode(value);

export const voiceSampleScreens = (value: string | undefined = process.env.VOICE_SAMPLE_SCREENS): ScreenMode => screenMode(value);

/** Night 5: Settings > AI assistant > "Opening line" (the text of the greeting, with {customer} {assistant} {business} {agent_role}, a voice preview, the "mention that I am an AI assistant" switch, and a per-campaign override). C1's API ships separately (lib/api/opening-line.ts has the assumed contract): `mock` = fake data kept in a cookie (nothing is sent, no sound), `1` = the API, unset = the part is not there. */
export const openingLineScreens = (value: string | undefined = process.env.OPENING_LINE_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "Voice" (owner decision 28 Oct, job-voice-picker.md): the approved voices of each language with a recorded sample, and the voice the workspace chooses per language. C1's endpoint (PR 153; lib/api/voice-picker.ts has the contract): `mock` = the approved catalogue with a choice kept in a cookie (the sounds are tones), `1` = the API, unset = the part is not there. */
export const voicePickerScreens = (value: string | undefined = process.env.VOICE_PICKER_SCREENS): ScreenMode => screenMode(value);

/** The guided demo (owner request 28 Oct, job-guided-demo.md): a "Start demo" button in the DEMO workspaces plays a short story over the real screens, with made-up data only. Off unless `1`. */
export const guidedDemo = (value: string | undefined = process.env.GUIDED_DEMO): boolean => value === "1";

/**
 * The demo-video mode (job demo-video): a scripted, click-paced story on Today for a screen recording, drawn from fixtures in the browser (nothing is read for it, sent or saved). Reachable only with `?demo=video`, only where this flag
 * is `on` (or `1`), and only for the Owner or an Admin of a workspace the API itself calls a demo one (lib/demo-video/guard.ts). Off unless set.
 */
export const demoVideo = (value: string | undefined = process.env.DEMO_VIDEO): boolean => value === "on" || value === "1";

/** "Talk to your assistant" in the browser (job DV, ADR 0118): the orb becomes a microphone and the assistant answers aloud over a WebSocket to the API. Off unless `1`. */
export const browserVoice = (value: string | undefined = process.env.BROWSER_VOICE): boolean => value === "1";

/** Settings > AI assistant > "About my business" (job context-and-easy-sources part A, contract-context-sources.md): the owner's own notes the assistant uses in chats, calls, Ask and drafts, with "add by paste, file or voice" and "Test it". `mock` = notes kept in the memory of the server (nothing is sent anywhere), `1` = the API (`/ai-assistant/context*`), unset = the part is not there. */
export const aboutBusinessScreens = (value: string | undefined = process.env.ABOUT_BUSINESS_SCREENS): ScreenMode => screenMode(value);

/** Lead sources as big simple cards (job context-and-easy-sources part B, contract-context-sources.md): one clear action and a live status each (Meta, IndiaMART, forwarded e-mails, website, files, WhatsApp, missed calls). `mock` = made-up cards kept in the memory of the server (nothing is sent), `1` = the API (`/lead-sources/cards` and its connect calls), unset = the part is not there. */
export const sourceCardsScreens = (value: string | undefined = process.env.SOURCE_CARDS_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "Automatic replies" (job DY, C1's `GET/PUT /ai-assistant/auto-reply`, Owner with the second factor): the switch that lets the assistant answer customers' WhatsApp messages on its own, with the standing rules in plain words and today's counts. `mock` = the switch kept in a cookie of the browser (nothing is sent), `1` = the API, unset = the part is not there. */
export const autoReplyScreens = (value: string | undefined = process.env.AUTO_REPLY_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "Pronunciation" (job pronunciation-quality, owner 30 Oct): the words the assistant must say a certain way (word + "sounds like" + Hear it in the chosen voice), and the "Mispronounced?" action on spoken chat messages. C1's API (`/ai-assistant/pronunciation`, lib/api/pronunciation.ts has the assumed contract): `mock` = the list kept in a cookie of the browser (the sounds are tones), `1` = the API, unset = the part is not there. */
export const pronunciationScreens = (value: string | undefined = process.env.PRONUNCIATION_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "How I talk to customers" (calls-like-a-pro part 3, C1's docs/contracts/talk-training.md): the greeting, how to address people, the questions to ask, the words never to say, answers to objections and good examples. The API exists, so there is no made-up mode: `1` = the API, anything else = the part is not there. */
export const talkTrainingScreens = (value: string | undefined = process.env.TALK_TRAINING_SCREENS): boolean => value === "1";

/**
 * "The assistant does the work" (job assistant-does-the-work, C2): files in the chat ("+" > Add a file, drag-and-drop), the work cards (a file's preview, plans with Do it / Change / Cancel and Undo, the secure key box,
 * guided setups with a live test, "can't do yet") and Settings > Activity. C1's API follows its contract docs/contracts/assistant-tools.md: `mock` = made-up answers in the browser and fixtures on the server (no file leaves
 * the page, nothing is stored), `1` = the API through this workspace's own routes, unset = the part is not there (the chat as before).
 */
export function assistantWorkScreens(tenantId: string, value: string | undefined = process.env.ASSISTANT_WORK_SCREENS, tenants: string | undefined = process.env.ASSISTANT_WORK_TENANTS): ScreenMode {
  return assistantWorkTenantListed(tenantId, tenants) ? screenMode(value) : "off";
}

/**
 * ASSISTANT_WORK_TENANTS (C1, 5 Nov; the same meaning in the API): which workspaces get "the assistant does the work", since one web serves every workspace. Unset = every workspace (local, tests);
 * workspace ids separated by ";" or "," = only those (case and spaces do not matter); set but empty, or "none" = no workspace.
 */
export function assistantWorkTenantListed(tenantId: string, tenants: string | undefined): boolean {
  if (tenants === undefined) return true;
  const ids = tenants.split(/[;,]/).map((t) => t.trim().toLowerCase()).filter((t) => t !== "" && t !== "none");
  return ids.includes(tenantId.trim().toLowerCase());
}

/** My AI team v2 (job ai-team-v2, owner 6 Nov 2026; C1's docs/contracts/ai-team.md): the day's shift timeline, the flow strip, the daily stand-up and the helper panel on /ai-team (and the stand-up card on Today). `mock` = the made-up day of
 * lib/api/ai-team-fixtures.ts with the switches kept in a cookie (nothing is sent; the stand-up's sound is a tone), `1` = the API, unset = the page the product had (the helpers' room). */
export const aiTeamScreens = (value: string | undefined = process.env.AI_TEAM_SCREENS): ScreenMode => screenMode(value);
/** The home page's business-number section (landing v2): "KYC done online" and its three KYC steps only once Exotel confirms customers can do the number's KYC online (owner, 6 Nov 2026). Off unless `1`: the section says "Your own business number", with no KYC line. */
export const siteKycCopy = (value: string | undefined = process.env.SITE_KYC_COPY): boolean => value === "1";

/** The home page's trial and GST words (landing v2): "Start 14-day trial", "Two plans. Rupees, GST included." and the trial's terms. Off until the lawyer's review and the GST registration are confirmed (owner, 6 Nov 2026): unset = "Get early access", "Two plans, priced in rupees.", "Free trial at launch. Details when we open." `1` = the later words. */
export const siteTrialCopy = (value: string | undefined = process.env.SITE_TRIAL_COPY): boolean => value === "1";

/** App v4 (job-app-v4.md, owner 6 Nov 2026): the new app, inside the workspace (the five-group menu first, then Today, the customer page and the rest, part by part). On in staging, off in production until the owner says: off unless `1`. */
export const appV4 = (value: string | undefined = process.env.APP_V4): boolean => value === "1";
