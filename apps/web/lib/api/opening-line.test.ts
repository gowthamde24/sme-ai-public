import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
const apiBinaryRequest = vi.fn();
const getAiAssistant = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a), apiBinaryRequest: (...a: unknown[]) => apiBinaryRequest(...a) }));
vi.mock("./ai-assistant", () => ({ getAiAssistant: (...a: unknown[]) => getAiAssistant(...a) }));

import { ApiContractError, ApiRequestError } from "./client";
import { PreviewUnsupported, getCampaignOpeningLine, getOpeningLine, previewOpeningLine, previewSpoken, putCampaignOpeningLine, putOpeningLine, savedGreetingText, wavSeconds } from "./opening-line";

const T = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const EN = "Hello {customer}, this is {assistant} from {business}.";
const CAMP = "Hi {customer}, a note about the offer from {business}.";
const DEFAULTS = Object.fromEntries(["en", "te", "hi", "kn", "ta", "ml", "mr", "bn"].map((l) => [l, { with_ai: `${l}: hello {customer}. I'm an AI assistant.`, without_ai: `${l}: hello {customer}.` }]));
const body = (over: Record<string, unknown> = {}) => ({ mention_ai: true, lines: [], campaign_overrides: [], placeholders: ["customer", "assistant", "business", "agent_role"], defaults: DEFAULTS, disclosure_notice: "x", wording: "draft", ...over });
const AI = `/v1/tenants/${T}/ai-assistant`;
beforeEach(() => {
  apiRequest.mockReset();
  apiBinaryRequest.mockReset();
  getAiAssistant.mockReset();
});

describe("the opening-line client (C1's API: job DT)", () => {
  it("reads the workspace's own lines (not a campaign's), the default of each language as the switch stands, and leaves mr and bn out", async () => {
    apiRequest.mockResolvedValue(body({ lines: [{ language: "en", campaign_id: null, text: EN }, { language: "en", campaign_id: C, text: CAMP }, { language: "mr", campaign_id: null, text: "नमस्कार {customer}, मी {assistant}." }] }));
    const got = await getOpeningLine("tok", T);
    expect(apiRequest).toHaveBeenCalledWith(`${AI}/opening-line`, "tok");
    expect(got.lines).toEqual({ en: EN });
    expect(got.mentionAi).toBe(true);
    expect(got.defaults.te).toBe("te: hello {customer}. I'm an AI assistant.");
    apiRequest.mockResolvedValue(body({ mention_ai: false }));
    expect((await getOpeningLine("tok", T)).defaults.te).toBe("te: hello {customer}.");
  });
  it("saves one request per language that changed (null = back to the default), then the switch", async () => {
    apiRequest.mockResolvedValue(body({ mention_ai: false }));
    const got = await putOpeningLine("tok", T, { en: EN, te: null }, false);
    expect(apiRequest.mock.calls.map((c) => [c[0], c[2].method, c[2].body])).toEqual([
      [`${AI}/opening-line`, "PUT", JSON.stringify({ language: "en", text: EN })],
      [`${AI}/opening-line`, "PUT", JSON.stringify({ language: "te", text: null })],
      [`${AI}/mention-ai`, "PUT", JSON.stringify({ mention_ai: false })],
    ]);
    expect(got.mentionAi).toBe(false);
  });
  it("a campaign has its own lines and switch (null follows the business); what the dialer uses falls back campaign, business, default", async () => {
    apiRequest.mockResolvedValue(body({ lines: [{ language: "en", campaign_id: null, text: EN }, { language: "te", campaign_id: C, text: "నమస్కారం {customer} గారు, ఈ ఆఫర్ గురించి {business} నుంచి." }], campaign_overrides: [{ campaign_id: C, mention_ai: false }] }));
    const got = await getCampaignOpeningLine("tok", T, C);
    expect(got.mentionAi).toBe(false);
    expect(got.lines).toEqual({ te: "నమస్కారం {customer} గారు, ఈ ఆఫర్ గురించి {business} నుంచి." });
    expect(got.effective.mentionAi).toBe(false);
    expect(got.effective.lines.en).toBe(EN); // the business's
    expect(got.effective.lines.hi).toBe("hi: hello {customer}."); // the default without the mention
    apiRequest.mockReset().mockResolvedValue(body());
    const followed = await putCampaignOpeningLine("tok", T, C, { en: CAMP }, null);
    expect(apiRequest.mock.calls.map((c) => c[2].body)).toEqual([JSON.stringify({ language: "en", campaign_id: C, text: CAMP }), JSON.stringify({ mention_ai: null, campaign_id: C })]);
    expect(followed.mentionAi).toBeNull();
  });
  it("refuses an answer that is not the contract, or holds a text the screens would not accept", async () => {
    apiRequest.mockResolvedValue({ nonsense: true });
    await expect(getOpeningLine("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(getCampaignOpeningLine("tok", T, C)).rejects.toBeInstanceOf(ApiContractError);
    apiRequest.mockResolvedValue(body({ lines: [{ language: "en", campaign_id: null, text: "short" }] }));
    await expect(getOpeningLine("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    apiRequest.mockResolvedValue(body({ defaults: { en: { with_ai: "x", without_ai: "y" } } }));
    await expect(getOpeningLine("tok", T)).rejects.toBeInstanceOf(ApiContractError);
  });
  it("never builds a path from an id that is not a uuid", async () => {
    await expect(getOpeningLine("tok", "a/b")).rejects.toBeInstanceOf(ApiContractError);
    await expect(getCampaignOpeningLine("tok", T, "../x")).rejects.toBeInstanceOf(ApiContractError);
    await expect(putCampaignOpeningLine("tok", T, "../x", {}, null)).rejects.toBeInstanceOf(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

const wav = (seconds: number, rate = 48000) => {
  const data = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + data);
  bytes.set([82, 73, 70, 70]); // RIFF
  new DataView(bytes.buffer).setUint32(28, rate, true);
  return bytes;
};

describe("hearing the line as it is on the screen", () => {
  const BODY = { language: "te", text: "నమస్కారం {customer} గారూ, నేను {assistant}.", mention_ai: true };
  it("sends the line with its placeholders and the switch, saves nothing, and brings back the sound with the EXACT words it spoke", async () => {
    apiRequest.mockResolvedValue({ spoken_text: "నమస్కారం రవి గారూ, నేను రమ్య.", audio: { mime: "audio/wav", base64: Buffer.from(wav(2)).toString("base64") }, engine: "cartesia" });
    const got = await previewSpoken("tok", T, { language: "te", text: BODY.text, mentionAi: true });
    expect(apiRequest).toHaveBeenCalledWith(`${AI}/voices/preview`, "tok", { method: "POST", body: JSON.stringify({ ...BODY, assistant_name: null }) });
    expect(got.spokenText).toBe("నమస్కారం రవి గారూ, నేను రమ్య.");
    expect(got.audio?.mime).toBe("audio/wav");
    expect(got.audio?.seconds).toBeCloseTo(2, 1);
  });
  it("no voice service (404 no_preview) is no sound and no claimed words; a route that is not there yet is PreviewUnsupported; other refusals are passed on; an answer without the words is refused", async () => {
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "no_preview", "x"));
    expect(await previewSpoken("tok", T, { language: "en", text: null, mentionAi: null })).toEqual({ audio: null, fake: false, spokenText: null });
    apiRequest.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    await expect(previewSpoken("tok", T, { language: "en", text: null, mentionAi: null })).rejects.toBeInstanceOf(PreviewUnsupported);
    apiRequest.mockRejectedValueOnce(new ApiRequestError(405, "method_not_allowed", "x"));
    await expect(previewSpoken("tok", T, { language: "en", text: null, mentionAi: null })).rejects.toBeInstanceOf(PreviewUnsupported);
    apiRequest.mockRejectedValueOnce(new ApiRequestError(429, "rate_limited", "x"));
    await expect(previewSpoken("tok", T, { language: "en", text: null, mentionAi: null })).rejects.toBeInstanceOf(ApiRequestError);
    apiRequest.mockResolvedValueOnce({ audio: { mime: "audio/wav", base64: "QUJD" } });
    await expect(previewSpoken("tok", T, { language: "en", text: null, mentionAi: null })).rejects.toBeInstanceOf(ApiContractError);
    apiRequest.mockResolvedValueOnce({ spoken_text: "Hi", audio: { mime: "text/html", base64: "QUJD" } });
    await expect(previewSpoken("tok", T, { language: "en", text: null, mentionAi: null })).rejects.toBeInstanceOf(ApiContractError);
  });
  it("THE opening line comes from the API's resolved field, with a typed-unsaved name when there is one, never made up", async () => {
    apiRequest.mockResolvedValueOnce({ resolved_opening_line: "Hello Ravi, this is the assistant of Pavers.", spoken_text: "Hello Ravi, this is the assistant of Pavers.", source: "default" });
    expect(await savedGreetingText("tok", T, "en")).toBe("Hello Ravi, this is the assistant of Pavers.");
    expect(apiRequest).toHaveBeenLastCalledWith(`${AI}/opening-line/resolved?language=en`, "tok");
    apiRequest.mockResolvedValueOnce({ resolved_opening_line: "Hello, this is kallu." });
    expect(await savedGreetingText("tok", T, "en", "kallu")).toBe("Hello, this is kallu.");
    expect(apiRequest).toHaveBeenLastCalledWith(`${AI}/opening-line/resolved?language=en&assistant_name=kallu`, "tok");
    apiRequest.mockResolvedValueOnce({ nope: 1 });
    expect(await savedGreetingText("tok", T, "en")).toBeNull();
    apiRequest.mockRejectedValueOnce(new ApiRequestError(500, "x", "x"));
    expect(await savedGreetingText("tok", T, "en")).toBeNull();
  });
});

describe("hearing the saved line", () => {
  it("asks for the voice preview in the voice in force (the API picks it) and the language, and hands the sound on with its length", async () => {
    apiBinaryRequest.mockResolvedValue({ bytes: wav(3).buffer, contentType: "audio/wav" });
    const got = await previewOpeningLine("tok", T, "te");
    expect(apiBinaryRequest.mock.calls[0][0]).toBe(`${AI}/voices/preview?language=te`);
    expect(got.audio?.mime).toBe("audio/wav");
    expect(got.audio?.seconds).toBeCloseTo(3, 1);
    expect(got.audio?.base64.length).toBeGreaterThan(100);
  });
  it("a sound that is not audio, or none (404 no_preview), is no sound; too many asks (429) is passed on", async () => {
    apiBinaryRequest.mockResolvedValue({ bytes: new ArrayBuffer(3), contentType: "text/html" });
    expect((await previewOpeningLine("tok", T, "en")).audio).toBeNull();
    apiBinaryRequest.mockRejectedValue(new ApiRequestError(404, "no_preview", "x"));
    expect((await previewOpeningLine("tok", T, "en")).audio).toBeNull();
    apiBinaryRequest.mockRejectedValue(new ApiRequestError(429, "rate_limited", "x"));
    await expect(previewOpeningLine("tok", T, "en")).rejects.toBeInstanceOf(ApiRequestError);
  });
  it("reads the length of a WAV from its header, and a guess of 4 seconds for anything else", () => {
    expect(wavSeconds(wav(2.5))).toBeCloseTo(2.5, 1);
    expect(wavSeconds(new Uint8Array(10))).toBe(4);
  });
});
