// @vitest-environment node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import type { Browser } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/v2/Orb", () => ({ Orb: () => null }));

import { appDict } from "@/i18n/app";
import { MOCK_LINES } from "@/lib/phone-lines/types";

import { BeforeYouStart } from "./BeforeYouStart";
import { CallBillingFacts } from "./CallBillingFacts";
import { CallsAtOnce } from "./CallsAtOnce";
import { HearItYourself } from "./HearItYourself";

/**
 * No sideways scroll on a phone (owner's rule: every page checked at 360, 390 and 412 px, and on a desktop; light and dark; English and the longest of the three other languages). The four pieces are drawn on the server, put on a page with the REAL stylesheet of the app
 * (design/v2.css through Tailwind, as the build makes it) and opened in a headless browser; the page is not wider than the window and no element reaches beyond it. Skipped, with the reason said, only where no browser can be started.
 */
const WEB = path.resolve(import.meta.dirname, "../../../../..");
const require = createRequire(import.meta.url);
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
const WIDTHS = [360, 390, 412, 1440] as const;
const SCHEMES = ["light", "dark"] as const;
const LANGS = ["en", "te", "hi", "kn"] as const;
const many = { total: 20, inUse: 7, lines: Array.from({ length: 20 }, (_, i) => ({ n: i + 1, state: i < 7 ? ("on_call" as const) : ("open" as const) })) };

let browser: Browser | null = null;
let css = "";
let why = "";

beforeAll(async () => {
  // the stylesheet is built here, as the build does (a failure here is a failure of the test, not a skip)
  const { default: postcss } = await import("postcss");
  const { default: tailwind } = await import("@tailwindcss/postcss");
  const file = path.join(WEB, "design/v2.css");
  css = (await postcss([tailwind()]).process(fs.readFileSync(file, "utf8"), { from: file })).css;
  try {
    const { chromium } = require(path.join(WEB, "node_modules", "playwright-core"));
    browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  } catch (error) {
    why = String(error);
    browser = null;
  }
}, 180_000);
afterAll(async () => {
  await browser?.close();
});

function pageFor(lang: (typeof LANGS)[number], scheme: (typeof SCHEMES)[number]): string {
  const words = appDict(lang) as Record<string, string>;
  const body = renderToStaticMarkup(
    <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-6 md:px-8 md:py-6">
      <div className="flex min-w-0 flex-col gap-4">
        <HearItYourself words={words} language="X" base={BASE} />
        <BeforeYouStart words={words} open />
      </div>
      <BeforeYouStart words={words} open={false} />
      <CallsAtOnce words={words} lines={MOCK_LINES} owner test />
      <CallsAtOnce words={words} lines={many} owner />
      <CallBillingFacts words={words} />
    </main>,
  );
  return `<!doctype html><html lang="${lang}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0"><div data-ui="v2" data-ds="6" data-theme="${scheme}" style="min-height:100vh;background:var(--v2-bg);color:var(--v2-ink)">${body}</div></body></html>`;
}

describe("the panel does not scroll sideways", () => {
  for (const lang of LANGS) {
    for (const scheme of SCHEMES) {
      it(`${lang}, ${scheme}: at 360, 390, 412 and 1440 px the page is no wider than the window and nothing reaches past it`, async (ctx) => {
        if (!browser) return ctx.skip(`no browser could be started here: ${why}`);
        const html = pageFor(lang, scheme);
        for (const width of WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
          try {
            await page.setContent(html);
            const out = await page.evaluate((w: number) => {
              const doc = document.documentElement;
              const past = [...document.querySelectorAll("body *")]
                .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > w + 0.5 || r.left < -0.5); })
                .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}`)
                .slice(0, 5);
              return { scroll: doc.scrollWidth, past, cards: document.querySelectorAll("[data-part]").length };
            }, width);
            expect(out.cards, `${lang} ${scheme} ${width}: the pieces are drawn`).toBeGreaterThanOrEqual(5);
            expect(out.scroll, `${lang} ${scheme} ${width}: page width`).toBeLessThanOrEqual(width);
            expect(out.past, `${lang} ${scheme} ${width}: elements past the window`).toEqual([]);
          } finally {
            await page.close();
          }
        }
      }, 120_000);
    }
  }
});
