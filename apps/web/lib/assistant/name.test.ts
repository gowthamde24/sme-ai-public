import { beforeEach, describe, expect, it, vi } from "vitest";

// React's `cache` memoises per request on the server; a test has no request, so a one-slot memo stands in for it.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T extends () => unknown>(fn: T): T => { let v: unknown; let has = false; return (() => (has ? v : ((has = true), (v = fn())))) as T; } }));

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), path: "", noHeaders: false }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined) }),
  headers: async () => {
    if (h.noHeaders) throw new Error("no request");
    return { get: (k: string) => (k === "x-sme-path" ? h.path : null) };
  },
}));

import { appDict, appT, frameLabels } from "@/i18n/app";
import { authDict } from "@/i18n/auth";
import { fill } from "@/i18n/fill";
import { getLang } from "@/i18n/get-lang";
import type { Lang } from "@/i18n/lang";
import { legalDict } from "@/i18n/legal";
import { siteDict } from "@/i18n/site";
import { wordsFor } from "@/i18n/app-words";
import { fillLegal } from "@/lib/legal/documents";

import appJson from "@/i18n/strings/app.json";

import { ASSISTANT_PLACEHOLDER, currentAssistantName, DEFAULT_ASSISTANT_NAME, withAssistantName } from "./name";
import { DEFAULT_NAME_BY_LANG } from "./default-name";
import { provideRequestAssistantName } from "./request-name";
import { MOCK_COOKIE } from "./source";
import { assistantProfile } from "./defaults";

const LANGS: Lang[] = ["en", "te", "hi", "kn"];
const mine = (name: string) => JSON.stringify({ ...assistantProfile(null).defaults, name });

beforeEach(() => {
  provideRequestAssistantName(DEFAULT_ASSISTANT_NAME);
  h.jar.clear();
  h.path = "";
  h.noHeaders = false;
  vi.unstubAllEnvs();
});

describe("the assistant's name (job DN)", () => {
  it("is your assistant until a workspace chooses one, and the placeholder is {assistant}", () => {
    expect(DEFAULT_ASSISTANT_NAME).toBe("your assistant");
    expect(ASSISTANT_PLACEHOLDER).toBe("{assistant}");
    expect(currentAssistantName()).toBe("your assistant");
  });

  it("puts the name in every place of a text, leaves other text alone, and takes the name as plain text", () => {
    expect(withAssistantName("Ask {assistant}. {assistant} answers.", "Asha")).toBe("Ask Asha. Asha answers.");
    expect(withAssistantName("No name here {brand}", "Asha")).toBe("No name here {brand}");
    expect(withAssistantName("Hi {assistant}", "$&x")).toBe("Hi $&x");
    expect(withAssistantName("Hi {assistant}")).toBe("Hi your assistant");
  });

  it("is what fill() puts for {assistant}, unless the caller gives one", () => {
    provideRequestAssistantName("Asha");
    expect(fill("Ask {assistant}")).toBe("Ask Asha");
    expect(fill("Ask {assistant}", { assistant: "Ravi" })).toBe("Ask Ravi");
    expect(fillLegal("{assistant} is an AI")).toBe("{assistant} is an AI"); // the legal texts name no assistant (they say "our AI assistant"), so a stray token stays visible
  });

  it.each(LANGS)("%s: every dictionary says the workspace's name and never a bare {assistant}", (lang) => {
    for (const name of [DEFAULT_ASSISTANT_NAME, "Asha Devi"]) {
      provideRequestAssistantName(name);
      for (const dict of [appDict(lang), siteDict(lang), legalDict(lang), authDict(lang)] as Record<string, string>[]) {
        for (const text of Object.values(dict)) expect(text, text).not.toContain("{assistant}");
      }
      expect(appDict(lang)["agent.main"]).toBe(name === DEFAULT_ASSISTANT_NAME ? (lang === "en" ? "Your assistant" : DEFAULT_NAME_BY_LANG[lang]) : name); // the default is "your assistant" in the reader's language, capitalised at a sentence start
      expect(appT(lang)("ask.title")).not.toMatch(/Agent OWL|\{assistant\}/);
    }
  });

  it("changes with the workspace without touching another one's words, and the frame and a screen's words follow", () => {
    provideRequestAssistantName("Asha");
    const asha = appDict("en")["agent.main"];
    provideRequestAssistantName("Ravi");
    expect(appDict("en")["agent.main"]).toBe("Ravi");
    expect(asha).toBe("Asha");
    provideRequestAssistantName("Asha");
    expect(appDict("en")["agent.main"]).toBe("Asha");
    expect(Object.values(frameLabels("te")).some((t) => t.includes("Asha"))).toBe(true);
    expect(Object.values(wordsFor("en", ["today.", "ask."])).some((t) => t.includes("Asha"))).toBe(true);
    expect(Object.values(wordsFor("en", ["today.", "ask."])).some((t) => t.includes("Ravi"))).toBe(false);
  });

  it("the Telugu, Hindi and Kannada strings keep the placeholder where English has it", () => {
    provideRequestAssistantName("Zed");
    for (const lang of ["te", "hi", "kn"] as const) {
      const dict = appDict(lang);
      for (const [k, v] of Object.entries(appJson as Record<string, { en: string }>)) if (v.en.includes("{assistant}")) expect(dict[k as keyof typeof dict], `${lang}:${k}`).toContain("Zed");
    }
  });
});

describe("getLang fixes the name for the request", () => {
  const inApp = "/app/tenants/t-1/today";

  it("is the owner's own name inside the app when the screens are on", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    h.path = inApp;
    h.jar.set(MOCK_COOKIE, mine("Asha"));
    expect(await getLang()).toBe("en");
    expect(currentAssistantName()).toBe("Asha");
  });

  it("is the default on the public site, with the screens off, with no saved name, or with a cookie that is not settings", async () => {
    h.jar.set(MOCK_COOKIE, mine("Asha"));
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    h.path = "/pricing";
    await getLang();
    expect(currentAssistantName()).toBe("your assistant");

    h.path = inApp;
    vi.stubEnv("ASSISTANT_SCREENS", "");
    await getLang();
    expect(currentAssistantName()).toBe("your assistant");

    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    h.jar.delete(MOCK_COOKIE);
    await getLang();
    expect(currentAssistantName()).toBe("your assistant");

    h.jar.set(MOCK_COOKIE, mine("<script>"));
    await getLang();
    expect(currentAssistantName()).toBe("your assistant");
    h.jar.set(MOCK_COOKIE, "{broken");
    await getLang();
    expect(currentAssistantName()).toBe("your assistant");
  });

  it("goes back to the default when the next page of the same server has no name (no leftovers), and never stops the language from being read", async () => {
    vi.stubEnv("ASSISTANT_SCREENS", "mock");
    h.path = inApp;
    h.jar.set(MOCK_COOKIE, mine("Asha"));
    await getLang();
    h.noHeaders = true;
    h.jar.set("sme_lang", "te");
    provideRequestAssistantName("your assistant");
    expect(await getLang()).toBe("te");
    expect(currentAssistantName()).toBe("your assistant");
  });
});
