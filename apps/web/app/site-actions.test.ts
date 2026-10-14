// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

let ip = "203.0.113.7";
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => (k === "x-forwarded-for" ? ip : null) }) }));

import { prepareContactChat, prepareQuoteChat } from "./site-actions";
import { SITE_PACKS } from "@/lib/site/packs";

const NUMBER = "919876543210";
const calc = SITE_PACKS.find((p) => p.calculator)!;
const good = { lang: "en", name: "Asha Rao", type: SITE_PACKS[0].slug, question: "Do you have a demo?", consent: true };
const goodQuote = { lang: "en", productId: calc.calculator!.products[0].id, area: 1000, unit: "sq_ft", name: "Ravi", city: "Guntur", consent: true };
const text = (url: string) => decodeURIComponent(new URL(url).searchParams.get("text") ?? "");

beforeEach(() => {
  process.env.STACK19_WHATSAPP = `+${NUMBER}`;
  ip = `198.51.100.${Math.floor(Math.random() * 250)}`; // a fresh address for each test: the limiter remembers an hour
});

describe("the contact form", () => {
  it("returns OUR WhatsApp address with a message made on the server from the checked pieces", async () => {
    const r = await prepareContactChat(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url.startsWith(`https://wa.me/${NUMBER}?text=`)).toBe(true);
      expect(text(r.url)).toContain("Asha Rao");
      expect(text(r.url)).toContain("Do you have a demo?");
    }
  });
  it("writes the message in the page's language", async () => {
    const r = await prepareContactChat({ ...good, lang: "te" });
    expect(r.ok && /నమస్కారం/.test(text(r.url))).toBe(true);
  });
  it("needs consent and a name; anything else is not consent", async () => {
    expect(await prepareContactChat({ ...good, consent: false })).toEqual({ ok: false, error: "consent" });
    expect(await prepareContactChat({ ...good, consent: "yes" })).toEqual({ ok: false, error: "consent" });
    expect(await prepareContactChat({ ...good, name: "   " })).toEqual({ ok: false, error: "name" });
    expect(await prepareContactChat({ ...good, name: 42 })).toEqual({ ok: false, error: "name" });
    expect(await prepareContactChat(null)).toEqual({ ok: false, error: "consent" });
  });
  it("says 'unavailable' when our number is not set up, and never puts the number in a refusal", async () => {
    delete process.env.STACK19_WHATSAPP;
    const r = await prepareContactChat(good);
    expect(r).toEqual({ ok: false, error: "unavailable" });
    process.env.STACK19_WHATSAPP = "not a number";
    expect(await prepareContactChat(good)).toEqual({ ok: false, error: "unavailable" });
    for (const refusal of [await prepareContactChat({ ...good, consent: false }), await prepareContactChat({ ...good, name: "" })]) expect(JSON.stringify(refusal)).not.toContain(NUMBER);
  });
  it("is limited to a few tries an hour from one address", async () => {
    ip = "192.0.2.99";
    let last;
    for (let i = 0; i < 12; i++) last = await prepareContactChat(good);
    expect(last).toEqual({ ok: false, error: "rate" });
    ip = "192.0.2.100";
    expect((await prepareContactChat(good)).ok).toBe(true); // another address is not slowed
  });
  it("treats an unknown business type as 'something else' and cleans the question (control characters, length)", async () => {
    const r = await prepareContactChat({ ...good, type: "../../etc", question: `a\u0000b\n${"x".repeat(900)}` });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(text(r.url)).not.toContain("etc");
      expect(text(r.url)).not.toContain("\u0000");
      expect(text(r.url).length).toBeLessThan(600);
    }
  });
});

describe("the calculator's 'Get exact quote on WhatsApp'", () => {
  it("works the numbers out again on the server and puts them in the message", async () => {
    const r = await prepareQuoteChat(goodQuote);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = text(r.url);
      expect(t).toMatch(/1,000 sq ft/);
      expect(t).toMatch(/4,725 blocks/); // the server's own result, not something the browser sent
      expect(t).toMatch(/2 truck trips/);
      expect(t).toContain("Ravi");
      expect(t).toContain("Guntur");
    }
  });
  it("ignores any number the browser adds: only the inputs count", async () => {
    const r = await prepareQuoteChat({ ...goodQuote, pieces: 1, trips: 99, total: 5 });
    expect(r.ok && /4,725 blocks/.test(text(r.url))).toBe(true);
  });
  it("needs consent and a name, a known paver, a unit and an area between 1 and 100,000", async () => {
    expect(await prepareQuoteChat({ ...goodQuote, consent: false })).toEqual({ ok: false, error: "consent" });
    expect(await prepareQuoteChat({ ...goodQuote, name: "" })).toEqual({ ok: false, error: "name" });
    for (const bad of [{ productId: "nope" }, { unit: "acres" }, { area: 0 }, { area: 100_001 }, { area: "1000" }, { area: Number.NaN }]) expect(await prepareQuoteChat({ ...goodQuote, ...bad }), JSON.stringify(bad)).toEqual({ ok: false, error: "invalid" });
  });
  it("is limited per address, and says 'unavailable' without our number", async () => {
    delete process.env.STACK19_WHATSAPP;
    expect(await prepareQuoteChat(goodQuote)).toEqual({ ok: false, error: "unavailable" });
    process.env.STACK19_WHATSAPP = NUMBER;
    ip = "192.0.2.150";
    let last;
    for (let i = 0; i < 12; i++) last = await prepareQuoteChat(goodQuote);
    expect(last).toEqual({ ok: false, error: "rate" });
  });
});
