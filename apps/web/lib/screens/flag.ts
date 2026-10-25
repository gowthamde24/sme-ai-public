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
