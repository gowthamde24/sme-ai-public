// Job CH (speed follow-ups) in the real-stack run, against the real web (3002) with a real signed-in browser. Run only these with E2E_ONLY=CH,B0 (B0 makes the two customers the page steps use; see be-stack.mjs).
// The lab numbers (first paint, bytes per script) are e2e/perf/measure.mjs; these are the guards that must hold on the real stack.

const SCRIPTS = [
  // language, a letter of its script, the unicode-range every face of that script starts with, the largest file the cut font may be (bytes; the file in design/indic-fonts was 67,264 / 85,428 / 49,364 when made)
  { lang: "te", letters: /[ఀ-౿]/, range: "C00-C7F", other: ["900-97F", "C80-CF3"], ceiling: 70_000 },
  { lang: "hi", letters: /[ऀ-ॿ]/, range: "900-97F", other: ["C00-C7F", "C80-CF3"], ceiling: 90_000 },
  { lang: "kn", letters: /[ಀ-೿]/, range: "C80-CF3", other: ["C00-C7F", "900-97F"], ceiling: 52_000 },
];

export async function chSteps(c) {
  const { step, page, must, BASE, context } = c;

  await step("CH1", "Indic fonts: each language downloads only its own script's font, cut to weights 400 to 700 (a third to a half smaller); the policy of the page is unchanged (scripts need the nonce, no 'unsafe-inline' for scripts)", async () => {
    const base = `${BASE}/app/tenants/${c.tenant}`;
    const notes = [];
    try {
      for (const s of SCRIPTS) {
        await context.addCookies([{ name: "sme_lang", value: s.lang, url: BASE }]);
        // the font files named by the page's own stylesheets (a font file in the browser's cache would not show in a network log, so the page is read, not watched)
        const res = await page.request.get(base);
        must(res.status() === 200, `Today (${s.lang}) answered ${res.status()}`);
        const html = await res.text();
        const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"|<link[^>]+href="([^"]+\.css[^"]*)"[^>]*rel="stylesheet"/g)].map((m) => m[1] ?? m[2]);
        must(sheets.length > 0, `no stylesheet link in the page (${s.lang})`);
        let face = null;
        let sheetUrl = "";
        for (const href of sheets) {
          const url = new URL(href, BASE).toString();
          const css = await (await page.request.get(url)).text();
          for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) if (block.includes(s.range) && /\.woff2/.test(block)) (face = block), (sheetUrl = url);
        }
        must(face !== null, `no @font-face for the ${s.lang} script (unicode-range ${s.range}) in the page's stylesheets`);
        must(/font-weight:\s*400 700/.test(face), `the ${s.lang} font is not the 400-700 cut: ${face.slice(0, 200)}`);
        const file = /url\(([^)]+\.woff2[^)]*)\)/.exec(face)?.[1].replace(/["']/g, "");
        const font = await page.request.get(new URL(file, sheetUrl).toString()); // the address in the stylesheet is relative to the stylesheet
        const bytes = (await font.body()).length;
        must(font.status() === 200 && /font|woff|octet/i.test(font.headers()["content-type"] ?? "") && bytes > 20_000 && bytes <= s.ceiling, `the ${s.lang} font file is ${bytes} bytes (the cut file is at most ${s.ceiling}; Google's 100-900 file was 90,000 to 124,000)`);

        // in the browser: the page shows the script, and the browser loaded that script's font and no other script's
        await page.goto(base, { waitUntil: "networkidle" });
        const body = await page.locator("body").innerText();
        must(s.letters.test(body), `no ${s.lang} letters on Today`);
        const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.unicodeRange));
        must(loaded.some((r) => r.includes(s.range)), `the ${s.lang} font was not used (loaded faces: ${loaded.length})`);
        for (const other of s.other) must(!loaded.some((r) => r.includes(other)), `a ${s.lang} page also loaded the font for ${other}`);
        notes.push(`${s.lang} ${(bytes / 1000).toFixed(1)} KB`);
      }
    } finally {
      await context.addCookies([{ name: "sme_lang", value: "en", url: BASE }]);
      await page.goto(base, { waitUntil: "networkidle" });
    }
    // an English page loads no Indic font at all
    const loadedEn = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.unicodeRange));
    must(!loadedEn.some((r) => /C00-C7F|900-97F|C80-CF3/.test(r)), "an English page loaded an Indic font");
    // the policy: unchanged. The nonce for scripts is still required; no 'unsafe-inline' for scripts (the stylesheet is still a file, not an inline <style>)
    const res = await page.request.get(base);
    const csp = res.headers()["content-security-policy"] ?? "";
    const scriptSrc = /(?:^|;\s*)script-src ([^;]*)/.exec(csp)?.[1] ?? "";
    must(/'nonce-[A-Za-z0-9+/=]+'/.test(scriptSrc) && /'strict-dynamic'/.test(scriptSrc), `script-src lost its nonce: ${scriptSrc}`);
    must(!/'unsafe-inline'/.test(scriptSrc), `script-src allows inline scripts: ${scriptSrc}`);
    must(!/<style[^>]+data-href=/.test(await res.text()), "the stylesheet is inlined into the page (experimental.inlineCss is on, which the page's policy does not allow)");
    return `${notes.join(", ")} (Google's files: 124, 121, 91 KB); script-src keeps its nonce`;
  }, page);

  await step("CH2", "pages that start their reads together: a customer, a lead, an enquiry and the agents page open; an unknown id, and a workspace the person is not in, show the same Not found screen", async () => {
    const t = `${BASE}/app/tenants/${c.tenant}`;
    const lead = c.customers.lakshmi;
    const ghost = "00000000-0000-4000-8000-00000000dead";
    const list = await c.api("GET", `${c.T()}/leads/${lead.lead}/enquiries`, null, c.ownerToken);
    const enquiry = (list.body?.enquiries ?? list.body ?? [])[0]?.id;
    const opens = [["company", `${t}/companies/${lead.company}`], ["lead", `${t}/leads/${lead.lead}`], ["agents", `${t}/agents`], ...(enquiry ? [["enquiry", `${t}/enquiries/${enquiry}`]] : [])];
    for (const [name, url] of opens) {
      const r = await page.goto(url, { waitUntil: "networkidle" });
      must(r && r.status() === 200, `${name}: HTTP ${r?.status()}`);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      must(!/Application error|This page could not be found|could not be loaded/i.test(body), `${name} did not draw: ${body.slice(0, 120)}`);
    }
    // a lead's page shows the customer's name as its title (the company read starts after the lead is known) and its evidence and suggestions sections
    await page.goto(`${t}/leads/${lead.lead}`, { waitUntil: "networkidle" });
    must((await page.locator("h1").first().innerText()).includes("Lakshmi"), "the lead page does not show the customer's name");
    // the page's own "Not found" screen (the status line stays 200 when the layout has already started to stream, as it always did: what counts is the screen, and that none of the customer's data is on it)
    for (const [name, url] of [["company", `${t}/companies/${ghost}`], ["lead", `${t}/leads/${ghost}`], ["enquiry", `${t}/enquiries/${ghost}`], ["a workspace the person is not in", `${BASE}/app/tenants/${ghost}/leads/${lead.lead}`]]) {
      await page.goto(url, { waitUntil: "networkidle" });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      must(/We could not find that page/.test(body), `an unknown ${name} did not show the Not found screen: ${body.slice(0, 160)}`);
      must(!body.includes("Lakshmi"), `the Not found screen of ${name} shows the customer's name`);
    }
    return `${opens.map((o) => o[0]).join(", ")} open; an unknown company, lead, enquiry and a foreign workspace show the same Not found screen`;
  }, page);
}
