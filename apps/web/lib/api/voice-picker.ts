import { ApiContractError, apiBinaryRequest, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parsePicker, VOICE_ID, type Picker, type PickerLang } from "@/lib/voice-picker/types";

/**
 * The voice picker from C1's API (contract-voice-picker.md, PR #153). Under `/v1/tenants/{id}/ai-assistant`, the signed-in person's own token:
 *
 *   GET /voices   any member -> { languages: [{ language, default_id, chosen_id | null, active_id, voices: [{ id, name, label, gender: "female"|"male", default, chosen, sample_url: "/v1/voice-samples/<id>.mp3" }] }] }  (te, hi, kn, en)
 *   PUT /voices   Owner, Admin { language, voice_id | null }   null = back to the default of that language   -> the same answer; 422 for an id that is not a voice of that language
 *   GET /v1/voice-samples/<id>.mp3   the pre-rendered sample, a static file, no sign-in; the browser never asks the API itself, our route does (the page's media rule allows only this app's address)
 * "Hear it" in the opening-line editor is `GET /voices/preview?language=` (lib/api/opening-line.ts), spoken in the voice in force.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/ai-assistant`;
};
const checked = (value: Picker | null): Picker => {
  if (value === null) throw new ApiContractError("Unexpected voice picker response.");
  return value;
};

export const getVoicePicker = async (token: string, tenantId: string): Promise<Picker> => checked(parsePicker(await apiRequest(`${base(tenantId)}/voices`, token)));

export async function putVoiceChoice(token: string, tenantId: string, language: PickerLang, voiceId: string | null): Promise<Picker> {
  if (voiceId !== null && !VOICE_ID.test(voiceId)) throw new ApiContractError("voice id");
  return checked(parsePicker(await apiRequest(`${base(tenantId)}/voices`, token, { method: "PUT", body: JSON.stringify({ language, voice_id: voiceId }) })));
}

/** The bytes of one sample (a file of about 100 KB, at most 1 MB); `path` has been through `safeSamplePath`. The API needs no sign-in for it; the person's token is sent like on every call of the app. */
export const getVoiceSampleFile = async (token: string, path: string): Promise<{ bytes: ArrayBuffer; contentType: string }> => apiBinaryRequest(path, token, 1_000_000);
