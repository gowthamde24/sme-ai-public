import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sheet: vi.fn(), tenant: vi.fn(), today: vi.fn(), profile: vi.fn() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "hi" }));
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => h.tenant(...a) }));
vi.mock("@/lib/api/job-templates", () => ({ readNewJobSheet: (...a: unknown[]) => h.sheet(...a) }));
vi.mock("@/lib/api/jobs", () => ({ readJobsToday: (...a: unknown[]) => h.today(...a) }));
vi.mock("@/lib/api/profile", () => ({ getProfile: (...a: unknown[]) => h.profile(...a) }));

import type { NewJobSheetData } from "@/lib/jobs/templates";

import { readSheetLoad } from "./sheet-load";

const T = "22222222-2222-4222-8222-222222222222";
const template = (sampleAudio: Record<string, string> | null) => ({ id: "t", sampleAudio });
const data = (sampleAudio: Record<string, string> | null) => ({ businessType: { pack: "p", name: { en: "x" } }, sampleItem: null, own: { pack: "p", status: "draft", version: 1, templates: [template(sampleAudio)] }, others: [] }) as unknown as NewJobSheetData;

beforeEach(() => {
  vi.clearAllMocks();
  h.tenant.mockResolvedValue({ name: "Neelambari Silks" });
  h.today.mockResolvedValue({ assistantName: "Asha" });
});

describe("the New job sheet's load", () => {
  it("nothing from the API (a 404 answered null): no load", async () => {
    h.sheet.mockResolvedValue(null);
    expect(await readSheetLoad("tok", T)).toBeNull();
  });
  it("a sample voice exists: the business's own language is read (the player's second choice); a business that lists English and Telugu talks Telugu", async () => {
    h.sheet.mockResolvedValue(data({ te: "/job-samples/p/t.te.mp3" }));
    h.profile.mockResolvedValue({ languages: ["en", "te"] });
    expect(await readSheetLoad("tok", T)).toMatchObject({ lang: "hi", business: "Neelambari Silks", assistant: "Asha", businessLang: "te" });
    expect(h.profile).toHaveBeenCalledTimes(1);
  });
  it("no sample voice anywhere: the profile is not even asked; a profile that cannot be read is no language, not a failure", async () => {
    h.sheet.mockResolvedValue(data(null));
    expect((await readSheetLoad("tok", T))?.businessLang).toBeNull();
    expect(h.profile).not.toHaveBeenCalled();
    h.sheet.mockResolvedValue(data({ en: "/job-samples/p/t.en.mp3" }));
    h.profile.mockRejectedValue(new Error("down"));
    expect((await readSheetLoad("tok", T))?.businessLang).toBeNull();
  });
});
