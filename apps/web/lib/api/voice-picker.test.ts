import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
const bin = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiBinaryRequest: (...a: unknown[]) => bin(...a) }));

import { ApiContractError } from "./client";
import { getVoicePicker, getVoiceSampleFile, putVoiceChoice } from "./voice-picker";

const T = "22222222-2222-4222-8222-222222222222";
const BODY = { languages: [{ language: "en", default_id: "en-janvi", chosen_id: null, active_id: "en-janvi", voices: [{ id: "en-janvi", name: "Janvi", label: "Calm", gender: "female", default: true, chosen: false, sample_url: "/v1/voice-samples/en-janvi.mp3" }] }] };
beforeEach(() => {
  apiRequest.mockReset();
  bin.mockReset();
});

describe("the voice picker client (C1's contract)", () => {
  it("reads the catalogue and the choices, and saves one choice per language (null = default)", async () => {
    apiRequest.mockResolvedValue(BODY);
    expect((await getVoicePicker("tok", T)).voices[0].name).toBe("Janvi");
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/ai-assistant/voices`, "tok");
    await putVoiceChoice("tok", T, "en", "en-janvi");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant/voices`, "tok", { method: "PUT", body: JSON.stringify({ language: "en", voice_id: "en-janvi" }) });
    await putVoiceChoice("tok", T, "en", null);
    expect(apiRequest).toHaveBeenLastCalledWith(expect.any(String), "tok", { method: "PUT", body: JSON.stringify({ language: "en", voice_id: null }) });
  });
  it("refuses an answer that is not the contract, a bad id and a workspace id that is not a uuid, before any request", async () => {
    apiRequest.mockResolvedValue({ nonsense: true });
    await expect(getVoicePicker("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(putVoiceChoice("tok", T, "en", "../x")).rejects.toBeInstanceOf(ApiContractError);
    apiRequest.mockClear();
    await expect(getVoicePicker("tok", "a/b")).rejects.toBeInstanceOf(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("fetches a sample file of at most 1 MB with the person's token", async () => {
    bin.mockResolvedValue({ bytes: new ArrayBuffer(3), contentType: "audio/mpeg" });
    expect((await getVoiceSampleFile("tok", "/v1/voice-samples/en-janvi.mp3")).contentType).toBe("audio/mpeg");
    expect(bin).toHaveBeenCalledWith("/v1/voice-samples/en-janvi.mp3", "tok", 1_000_000);
  });
});
