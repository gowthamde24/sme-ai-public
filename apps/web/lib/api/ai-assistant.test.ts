import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseSettings } from "@/lib/assistant/types";

import { fromApiSettings, getAiAssistant, parseAiAssistant, putAiAssistant, toApiSettings } from "./ai-assistant";

const request = vi.hoisted(() => vi.fn());
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => request(...a) }));

const examples = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "contracts", "assistant_settings.examples.json"), "utf8"));
const T = "22222222-2222-2222-2222-222222222222";

beforeEach(() => request.mockReset());

describe("Settings > AI assistant from C1's API (job DO)", () => {
  it("reads every example payload of the contract: textiles, construction (saved) and a school", () => {
    for (const key of ["assistant_defaults_textiles", "assistant_saved_construction", "assistant_defaults_education"]) {
      const got = parseAiAssistant(examples[key]);
      expect(parseSettings({ ...got.settings, name: got.saved ? got.settings.name : "Meera" }), key).not.toBeNull(); // an unsaved workspace has no name yet
    }
  });
  it("maps field by field: voice, language, style, the four things it may do, hours in minutes, days 1 to 7, the order limit in paise", () => {
    const api = { ...examples.assistant_saved_construction.settings, name: "Meera", style: "respectful", call_days: [1, 3, 7], call_from_minute: 585, call_to_minute: 1200, handover_order_above_paise: 2_500_000, may_talk_dues: true };
    const s = fromApiSettings(api)!;
    expect(s).toMatchObject({ name: "Meera", style: "resp", hours: { from: "09:45", to: "20:00", days: ["mon", "wed", "sun"] }, handover: { orderAbove: 25_000 }, may: { dues: true } });
    expect(toApiSettings(s)).toEqual({ ...api, speed: s.speed });
  });
  it("sends the whole body the API asks for, every field, and it is what the API's own example looks like", () => {
    const body = toApiSettings(fromApiSettings(examples.settings_save_request)!);
    expect(Object.keys(body).sort()).toEqual(Object.keys(examples.settings_save_request).sort());
  });
  it("before the first save there is NO name (the API makes none up: the screen says \"your assistant\" and a save asks for a real one), and the rest of the settings still read; once saved the name is the owner's", () => {
    for (const apiName of ["", "Vijaya"]) {
      const got = parseAiAssistant({ ...examples.assistant_defaults_textiles, settings: { ...examples.assistant_defaults_textiles.settings, name: apiName } });
      expect(got.settings.name).toBe("");
      expect(got.saved).toBe(false);
      expect(got.settings.hours.days.length).toBeGreaterThan(0);
    }
    expect(parseAiAssistant({ ...examples.assistant_defaults_textiles, settings: { ...examples.assistant_defaults_textiles.settings, name: "Meera" }, saved: true }).settings.name).toBe("Meera");
    expect(() => parseAiAssistant({ ...examples.assistant_defaults_textiles, settings: { ...examples.assistant_defaults_textiles.settings, name: "" }, saved: true })).toThrow(); // a saved workspace has a name
  });
  it("refuses a value outside its shape: a day, a minute, a paise amount that is not whole rupees, a voice, a name with markup", () => {
    const ok = examples.assistant_saved_construction.settings;
    for (const bad of [{ call_days: [0] }, { call_days: [8] }, { call_from_minute: 5000 }, { call_from_minute: 120 }, { handover_order_above_paise: 150 }, { voice_persona: "robot" }, { name: "<b>x</b>" }, { speed: 3 }, { max_discount_percent: 90 }]) expect(fromApiSettings({ ...ok, ...bad }), JSON.stringify(bad)).toBeNull();
    expect(() => parseAiAssistant({ settings: { ...ok, voice_persona: "robot" }, saved: true })).toThrow();
    expect(() => parseAiAssistant({})).toThrow();
  });
  it("GET and PUT use the workspace's own path and the person's token; an address that is not a workspace is refused", async () => {
    request.mockResolvedValueOnce(examples.assistant_saved_construction);
    await getAiAssistant("tok", T);
    expect(request).toHaveBeenCalledWith(`/v1/tenants/${T}/ai-assistant`, "tok");
    request.mockResolvedValueOnce(null);
    const s = fromApiSettings(examples.settings_save_request)!;
    await putAiAssistant("tok", T, s);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant`, "tok", { method: "PUT", body: JSON.stringify(toApiSettings(s)) });
    await expect(getAiAssistant("tok", "x")).rejects.toThrow();
    await expect(putAiAssistant("tok", "../x", s)).rejects.toThrow();
  });
});
