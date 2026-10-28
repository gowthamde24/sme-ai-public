import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "./client";

const bin = vi.fn();
const req = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiBinaryRequest: (...a: unknown[]) => bin(...a), apiRequest: (...a: unknown[]) => req(...a) }));

import { getVoicePreview, getVoicePreviewText } from "./voice-samples";

const T = "22222222-2222-2222-2222-222222222222";
const q = { voice: "male_calm" as const, lang: "ml" as const, tone: "crisp" as const, name: "Asha" };
beforeEach(() => {
  bin.mockReset();
  req.mockReset();
});

describe("the voice preview from the API (job DT; the picker of job DQ part 3)", () => {
  it("asks with the API's words (language, style quick for crisp) and returns audio", async () => {
    bin.mockResolvedValueOnce({ bytes: new ArrayBuffer(3), contentType: "audio/wav" });
    expect(await getVoicePreview("tok", T, q)).toMatchObject({ contentType: "audio/wav" });
    const [path, token] = bin.mock.calls[0];
    expect(path).toBe(`/v1/tenants/${T}/ai-assistant/voice-preview?voice=male_calm&language=ml&style=quick&name=Asha`);
    expect(token).toBe("tok");
  });
  it("is null for a type that is not audio or when the API has none (404); other failures are thrown", async () => {
    bin.mockResolvedValueOnce({ bytes: new ArrayBuffer(3), contentType: "text/html" });
    expect(await getVoicePreview("tok", T, q)).toBeNull();
    bin.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await getVoicePreview("tok", T, q)).toBeNull();
    bin.mockRejectedValueOnce(new ApiRequestError(500, "boom", "x"));
    await expect(getVoicePreview("tok", T, q)).rejects.toThrow();
  });
  it("refuses a workspace id that is not a UUID before any request", async () => {
    await expect(getVoicePreview("tok", "x", q)).rejects.toThrow();
    expect(bin).not.toHaveBeenCalled();
  });
});

describe("the words of the preview", () => {
  it("asks for the same choices and reads the text with the real names", async () => {
    req.mockResolvedValueOnce({ text: "Hello from Pavers Corner", assistant_name: "Asha", business_name: "Pavers Corner", language: "ml", style: "quick" });
    expect(await getVoicePreviewText("tok", T, q)).toEqual({ text: "Hello from Pavers Corner", assistantName: "Asha", businessName: "Pavers Corner" });
    expect(req.mock.calls[0][0]).toBe(`/v1/tenants/${T}/ai-assistant/voice-preview/text?language=ml&style=quick&name=Asha`);
  });
  it("is null when the API has none (404); a body that is not the contract is an error", async () => {
    req.mockRejectedValueOnce(new ApiRequestError(404, "no_sample", "x"));
    expect(await getVoicePreviewText("tok", T, q)).toBeNull();
    req.mockResolvedValueOnce({ text: "" });
    await expect(getVoicePreviewText("tok", T, q)).rejects.toThrow();
  });
});
