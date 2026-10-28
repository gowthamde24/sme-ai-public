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

/** "Talk to your assistant" in the browser (job DV, ADR 0118): the orb becomes a microphone and the assistant answers aloud over a WebSocket to the API. Off unless `1`. */
export const browserVoice = (value: string | undefined = process.env.BROWSER_VOICE): boolean => value === "1";

/** Settings > AI assistant > "About my business" (job context-and-easy-sources part A, contract-context-sources.md): the owner's own notes the assistant uses in chats, calls, Ask and drafts, with "add by paste, file or voice" and "Test it". `mock` = notes kept in the memory of the server (nothing is sent anywhere), `1` = the API (`/ai-assistant/context*`), unset = the part is not there. */
export const aboutBusinessScreens = (value: string | undefined = process.env.ABOUT_BUSINESS_SCREENS): ScreenMode => screenMode(value);
