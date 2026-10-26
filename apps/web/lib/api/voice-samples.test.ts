import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "./client";

const bin = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiBinaryRequest: (...a: unknown[]) => bin(...a) }));

import { getVoiceSample } from "./voice-samples";

const T = "22222222-2222-2222-2222-222222222222";
const q = { voice: "male_calm" as const, lang: "ml" as const, tone: "crisp" as const, name: "Asha" };
beforeEach(() => bin.mockReset());

describe("the voice sample from the API (job DQ part 3)", () => {
  it("asks with the API's words (language, style quick for crisp) and returns audio", async () => {
    bin.mockResolvedValueOnce({ bytes: new ArrayBuffer(3), contentType: "audio/wav" });
    expect(await getVoiceSample("tok", T, q)).toMatchObject({ contentType: "audio/wav" });
    const [path, token] = bin.mock.calls[0];
    expect(path).toBe(`/v1/tenants/${T}/ai-assistant/voice-sample?voice=male_calm&language=ml&style=quick&name=Asha`);
    expect(token).toBe("tok");
  });
  it("is null for a type that is not audio or when the API has none (404); other failures are thrown", async () => {
    bin.mockResolvedValueOnce({ bytes: new ArrayBuffer(3), contentType: "text/html" });
    expect(await getVoiceSample("tok", T, q)).toBeNull();
    bin.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await getVoiceSample("tok", T, q)).toBeNull();
    bin.mockRejectedValueOnce(new ApiRequestError(500, "boom", "x"));
    await expect(getVoiceSample("tok", T, q)).rejects.toThrow();
  });
  it("refuses a workspace id that is not a UUID before any request", async () => {
    await expect(getVoiceSample("tok", "x", q)).rejects.toThrow();
    expect(bin).not.toHaveBeenCalled();
  });
});
