import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { MOCK_DEFAULTS } from "@/lib/opening-line/types";

import { ApiContractError } from "./client";
import { getCampaignOpeningLine, getOpeningLine, previewOpeningLine, putCampaignOpeningLine, putOpeningLine } from "./opening-line";

const T = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const EN = "Hello {customer}, this is {assistant} from {business}.";
beforeEach(() => apiRequest.mockReset());

describe("the opening-line client (assumed contract, see the file)", () => {
  it("reads and writes the workspace's line at /opening-line with the person's token, sending only the texts and the switch", async () => {
    apiRequest.mockResolvedValue({ lines: { en: EN }, defaults: MOCK_DEFAULTS, mention_ai: true });
    expect(await getOpeningLine("tok", T)).toMatchObject({ lines: { en: EN }, mentionAi: true });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${T}/opening-line`, "tok");
    await putOpeningLine("tok", T, { en: EN, te: null }, false);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/opening-line`, "tok", { method: "PUT", body: JSON.stringify({ lines: { en: EN, te: null }, mention_ai: false }) });
  });
  it("reads and writes a campaign's at /opening-line/campaigns/{id}; null follows the business", async () => {
    apiRequest.mockResolvedValue({ lines: {}, mention_ai: null, effective: { lines: MOCK_DEFAULTS, mention_ai: true } });
    expect(await getCampaignOpeningLine("tok", T, C)).toMatchObject({ mentionAi: null });
    await putCampaignOpeningLine("tok", T, C, { en: null }, null);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/opening-line/campaigns/${C}`, "tok", { method: "PUT", body: JSON.stringify({ lines: { en: null }, mention_ai: null }) });
  });
  it("asks for a preview of the filled text in a language, and refuses an answer that is not the contract's", async () => {
    apiRequest.mockResolvedValue({ audio_base64: null, fake: true });
    expect(await previewOpeningLine("tok", T, "te", "నమస్కారం", true)).toEqual({ audio: null, fake: true });
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/opening-line/preview`, "tok", { method: "POST", body: JSON.stringify({ language: "te", text: "నమస్కారం", mention_ai: true }) });
    apiRequest.mockResolvedValue({ nonsense: true });
    await expect(getOpeningLine("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(getCampaignOpeningLine("tok", T, C)).rejects.toBeInstanceOf(ApiContractError);
  });
  it("never builds a path from an id that is not a uuid", async () => {
    await expect(getOpeningLine("tok", "a/b")).rejects.toBeInstanceOf(ApiContractError);
    await expect(getCampaignOpeningLine("tok", T, "../x")).rejects.toBeInstanceOf(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
