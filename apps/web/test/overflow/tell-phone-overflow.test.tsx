import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import type { KycStatus } from "@/lib/api/business-kyc";
import { mockDraft } from "@/lib/jobs/tell";
import type { OwnNumber, SearchResult } from "@/lib/phone-picker/types";
import type { Lang } from "@/i18n/lang";

import { TellAssistant } from "@/components/v2/app/jobs/tell/TellAssistant";
import { PhoneBuy } from "@/components/v2/app/phone/PhoneBuy";
import { VerifyBusiness } from "@/components/v2/app/phone/VerifyBusiness";

/**
 * No sideways overflow at 360, 390 and 412 px (phones) and at 1440 (desktop), in English and in Telugu (the longest words), for every state of Tell your assistant, Get a phone number and Verify your business.
 * jsdom cannot measure a layout, so each state is drawn here (the real components, driven by clicks), its HTML is taken, and a real headless Chromium lays it out with the app's own stylesheet (design/v2.css compiled by
 * Tailwind): an element whose right edge is past the screen, or a page that scrolls sideways, fails the test. Skipped (with a line saying so) where no Chromium of Playwright is installed.
 */
const CACHE = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
function chromiumPath(): string | null {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  try {
    for (const d of fs.readdirSync(CACHE).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
      const root = path.join(CACHE, d);
      for (const sub of fs.readdirSync(root).filter((x) => x.startsWith("chrome-headless-shell"))) {
        const bin = path.join(root, sub, "chrome-headless-shell");
        if (fs.existsSync(bin)) return bin;
      }
    }
  } catch {
    // no cache folder: no browser
  }
  return null;
}
const BROWSER = chromiumPath();

const N = (n: string) => ({ number: n, display: `+91 ${n.slice(3, 8)} ${n.slice(8)}`, type: "mobile" as const });
const LIST: SearchResult = { ok: true, numbers: ["+919429492465", "+919429492466", "+919429492467"].map(N), page: 1, more: true };
const OWN: OwnNumber = { ...N("+919429492465"), state: "calls_off", label: null };
const STATUS = (over: Partial<KycStatus> = {}): KycStatus => ({ state: "created", accountType: "business", step: null, steps: {}, missing: [], reason: null, ...over });
const ok = <T,>(data: T) => async () => ({ ok: true as const, data });

type Shot = { name: string; lang: Lang; html: string };
const shots: Shot[] = [];
const wordsOf = (lang: Lang, prefixes: string[]) => Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => prefixes.some((p) => k.startsWith(p))));
const take = (name: string, lang: Lang, container: HTMLElement) => shots.push({ name: `${name}/${lang}`, lang, html: container.innerHTML });

async function tell(lang: Lang) {
  const words = wordsOf(lang, ["jobs.tell.", "jobs.kind.", "jobs.f.", "jobs.opt."]);
  const actions = { describe: async (i: { text: string; mode: never }) => ({ ok: true as const, data: mockDraft(i.text, i.mode) }), turnOn: ok({ jobId: null, waiting: true, saved: true }) };
  const { container } = render(<TellAssistant words={words} base="/app/tenants/t" actions={actions as never} />);
  take("tell-1", lang, container);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Call everyone who asks about a saree and book a visit" } });
  fireEvent.click(container.querySelector('[data-part="tell-go"]')!);
  await waitFor(() => expect(container.querySelector('[data-part="tell-draft"]')).not.toBeNull());
  take("tell-2-draft", lang, container);
  cleanup();
}
async function buy(lang: Lang) {
  const words = wordsOf(lang, ["pick."]);
  const actions = { search: async () => LIST, buy: async () => ({ ok: false as const, error: "unavailable", reason: "kyc_required" }) };
  const { container } = render(<PhoneBuy words={words} actions={actions} canEdit email="someone.with.a.long.address@a-business-name.example.in" verifyHref="/v" />);
  await waitFor(() => expect(container.querySelectorAll('input[type="radio"]').length).toBe(3));
  take("buy-1", lang, container);
  fireEvent.click(container.querySelectorAll('input[type="radio"]')[0]);
  fireEvent.click(container.querySelector('[data-part="use"]')!);
  fireEvent.click(container.querySelector('[data-seg="business"]')!);
  fireEvent.change(container.querySelector("#buy-name")!, { target: { value: "Venkata Subrahmanyeswara Prasad Gundlapalli" } });
  take("buy-2", lang, container);
  fireEvent.click(container.querySelector('[data-part="next-2"]')!);
  take("buy-3", lang, container);
  fireEvent.click(container.querySelector('[data-part="next-3"]')!);
  fireEvent.click(container.querySelector("#buy-agree")!);
  fireEvent.click(container.querySelector('[data-part="confirm"]')!);
  await waitFor(() => expect(container.querySelector('[data-part="buy-error"]')).not.toBeNull());
  take("buy-4-error", lang, container);
  cleanup();
}
function verify(lang: Lang) {
  const words = wordsOf(lang, ["pick."]);
  const actions = { status: async () => null, start: ok(STATUS()), details: ok(STATUS()), pan: ok(STATUS()), gst: ok(STATUS()), aadhaar: ok({ url: "https://digilocker.example/start?session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), submit: ok(STATUS()), uploadUrl: "/up" };
  for (const [name, status, own] of [
    ["verify-details", STATUS({ state: "created" }), OWN],
    ["verify-pan", STATUS({ state: "in_progress", step: "pan", steps: { pan: false, aadhaar: false, gst: false } }), OWN],
    ["verify-gst", STATUS({ state: "in_progress", step: "gst", steps: { pan: true, aadhaar: true, gst: false } }), OWN],
    ["verify-submit", STATUS({ state: "in_progress", step: "complete", steps: { pan: true, aadhaar: true, gst: true } }), OWN],
    ["verify-checking", STATUS({ state: "submitted" }), OWN],
    ["verify-done", STATUS({ state: "verified" }), OWN],
    ["verify-none", STATUS({ state: "not_started", accountType: null }), null],
  ] as const) {
    const { container } = render(<VerifyBusiness words={words} status={status} own={own} canEdit actions={actions as never} buyHref="/b" mock />);
    take(name, lang, container);
    cleanup();
  }
}

beforeAll(async () => {
  for (const lang of ["en", "te"] as const) {
    await tell(lang);
    await buy(lang);
    verify(lang);
  }
}, 60_000);
afterAll(cleanup);

describe("no sideways overflow: Tell your assistant, Get a phone number, Verify your business", () => {
  it.skipIf(BROWSER === null)(
    "at 360, 390 and 412 px and at 1440, in English and in Telugu, light and dark",
    async () => {
      const { default: postcss } = await import("postcss");
      const { default: tailwind } = await import("@tailwindcss/postcss");
      const entry = path.resolve("design/v2.css");
      const css = (await postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync(entry, "utf8"), { from: entry })).css;
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({ executablePath: BROWSER as string });
      const bad: string[] = [];
      try {
        const page = await browser.newPage();
        for (const width of [360, 390, 412, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const theme of ["light", "dark"]) {
            for (const shot of shots) {
              const doc = `<!doctype html><html lang="${shot.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0"><div data-ui="v2" data-ds="6" data-jobs="1" data-theme="${theme}" lang="${shot.lang}"><main class="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-6 md:px-8 md:py-6">${shot.html}</main></div></body></html>`;
              await page.setContent(doc, { waitUntil: "load" });
              const found = await page.evaluate(() => {
                const vw = window.innerWidth;
                const out: string[] = [];
                if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
                for (const el of Array.from(document.querySelectorAll("main *"))) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed" && !el.closest("[data-scrolls]")) out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} right edge ${Math.round(r.right)} > ${vw}`);
                  if (out.length > 3) break;
                }
                return out;
              });
              for (const f of found) bad.push(`${width}px ${theme} ${shot.name}: ${f}`);
            }
          }
        }
      } finally {
        await browser.close();
      }
      expect(bad).toEqual([]);
    },
    240_000,
  );
  it("has drawn every state it measures", () => {
    expect(shots.length).toBe(2 * (2 + 4 + 7));
  });
});
