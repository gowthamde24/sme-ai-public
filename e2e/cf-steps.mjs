// Job CF, part 2 (the speed pass) in the real-stack run: what a returning visitor and a phone on a slow network get, checked against the real web (3002) with a real signed-in browser.
// Run only these with E2E_ONLY=CF (see be-stack.mjs). The measurements of the lab (LCP, TBT, ...) are e2e/perf/measure.mjs; these are the guards that must hold on the real stack.
import zlib from "node:zlib";

export async function cfSteps(c) {
  const { step, page, must, BASE } = c;

  await step("CF1", "speed guards: the signed-in page carries only the frame's words (not every screen's), is small on the wire, the icons and the hashed files are cached, and Telugu still reaches the frame", async () => {
    const base = `${BASE}/app/tenants/${c.tenant}`;
    // the document of Today as the signed-in browser gets it
    const res = await page.request.get(base);
    must(res.status() === 200, `Today answered ${res.status()}`);
    const html = await res.text();
    const gz = zlib.gzipSync(Buffer.from(html), { level: 6 }).length;
    must(gz < 42_000, `the Today document is ${gz} B gzip (the ceiling is 42,000: it was 49,000 before the frame stopped carrying every screen's words)`);
    // words of other screens (the contact page, the connections page, the agent settings) must not ride along on every page: Today has none of the first two and a handful of the third (before: 42, 17 and 61)
    for (const key of ["contact.", "integrations."]) must(!html.includes(`"${key}`), `the page still carries the words "${key}*" of another screen`);
    const agentset = html.split('"agentset.').length - 1;
    must(agentset <= 5, `the page carries ${agentset} words of the agent settings screen`);
    must(html.includes('"nav.item.today"') || html.includes("nav.item.today"), "the frame's own words are missing");

    // the app icons: a day, with a week of "serve while checking"; a hashed file: a year, immutable
    const icon = await page.request.get(`${BASE}/icons/icon-192.png`);
    must(icon.status() === 200 && /max-age=86400/.test(icon.headers()["cache-control"] ?? ""), `the icon is cached for: ${icon.headers()["cache-control"]}`);
    const chunk = /\/_next\/static\/chunks\/[^"']+\.js/.exec(html)?.[0];
    must(Boolean(chunk), "no script file in the page");
    const js = await page.request.get(`${BASE}${chunk}`);
    // (the real-stack run serves the web in development mode, which sends "no-cache, must-revalidate" for its files; the production build's "public, max-age=31536000, immutable" is what e2e/perf/measure.mjs records)
    const jsCache = js.headers()["cache-control"] ?? "";
    must(/immutable/.test(jsCache) || /must-revalidate/.test(jsCache), `a hashed file is cached for: ${jsCache}`);
    // the page itself is never cached
    must(!/max-age=[1-9]/.test(res.headers()["cache-control"] ?? ""), `the page says: ${res.headers()["cache-control"]}`);

    // Telugu still reaches the words the frame reads (the bell's name, the menu): the narrower set has all of them
    await page.context().addCookies([{ name: "sme_lang", value: "te", url: BASE }]);
    try {
      await page.goto(base, { waitUntil: "networkidle" });
      const bell = await page.locator('[data-notify="bell"]').first().getAttribute("aria-label");
      must(Boolean(bell) && !/^Notifications/.test(bell), `the bell is still in English in Telugu: ${bell}`);
      const menu = await page.locator("nav a").first().innerText();
      must(/[ఀ-౿]/.test(menu), `the menu is not in Telugu: ${menu}`);
    } finally {
      await page.context().addCookies([{ name: "sme_lang", value: "en", url: BASE }]);
      await page.goto(base, { waitUntil: "networkidle" });
    }
    return `Today document ${gz} B gzip; icon ${icon.headers()["cache-control"]}; hashed file ${/immutable/.test(jsCache) ? "immutable" : "(development server: not cached)"}; Telugu frame words present`;
  }, page);
}
