import { ApiContractError, apiBinaryRequest, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parsePicker, VOICE_ID, type Picker, type PickerLang } from "@/lib/voice-picker/types";

/**
 * The voice picker from C1's API (job-voice-picker.md; ASSUMED CONTRACT until C1's endpoint is on main: when it lands, make the names below match or change this one file). Under `/v1/tenants/{id}/ai-assistant`, the signed-in person's own token:
 *
 *   GET /voices          any member -> { voices: [{ id, language, name, label, gender: "female"|"male", default: bool, sample_url: "/path" | null }], choices: { <lang>: <voice id> | null } }
 *   PUT /voice-choice    Owner, Admin { language, voice_id | null }   null = back to the default of that language   -> the same answer
 *   GET <sample_url>     the pre-rendered sample of one voice, a static file (audio/mpeg or audio/wav): made ONCE per voice, never by the voice service on a click
 * Only ids of the catalogue are accepted (422 otherwise); a member who is not Owner or Admin is refused (403); calls and the voice preview use the chosen voice, else the default, else the fallback of the same gender.
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
  return checked(parsePicker(await apiRequest(`${base(tenantId)}/voice-choice`, token, { method: "PUT", body: JSON.stringify({ language, voice_id: voiceId }) })));
}

/** The bytes of one sample (a file of at most 1 MB); `path` has been through `safeSamplePath`. */
export const getVoiceSampleFile = async (token: string, path: string): Promise<{ bytes: ArrayBuffer; contentType: string }> => apiBinaryRequest(path, token, 1_000_000);
