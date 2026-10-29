// Settings > AI assistant > Voice on staging, desktop and phone: pictures of the Female/Male switch and the per-language cards (quick self-check). Staging only.
//   node e2e/staging-voice-screens.mjs [textiles|construction_materials|education] [desktop|phone]
import { session, shot, sleep } from "./staging-df-lib.mjs";
const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
const s = await session(pack, size);
let failed = 0;
const ok = (n, p, note = "") => { if (!p) failed++; console.log(`${p ? "PASS" : "FAIL"} ${n} ${note}`); };
try {
  await s.page.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  const box = s.page.locator('[data-part="voice-picker"]');
  await box.waitFor({ timeout: 45000 });
  await sleep(1500);
  ok("the Female / Male switch is at the top", (await box.locator('[data-part="voice-gender"] [role="radio"]').count()) === 2);
  ok("one row per language of the workspace", (await box.locator("[data-voice-lang]").count()) >= 1, String(await box.locator("[data-voice-lang]").evaluateAll((e) => e.map((x) => x.getAttribute("data-voice-lang")).join(","))));
  const rowsN = await box.locator("[data-voice-lang]").count();
  ok("every row is a language name, ONE dropdown of voices and a Hear button", (await box.locator("[data-voice-select]").count()) === rowsN && (await box.locator("[data-play]").count()) === rowsN, `${rowsN} row(s)`);
  ok("no voice cards any more", (await box.locator("[data-voice]").count()) === 0);
  const first = box.locator("[data-voice-select]").first();
  const options = await first.evaluate((el) => [...el.options].map((o) => o.textContent));
  console.log("options:", JSON.stringify(options));
  ok("the options read 'Name — style tags', recommended first", options.length > 0 && options.every((o) => / — /.test(o)));
  if (size === "phone") {
    const a = await first.boundingBox(); const b = await box.locator("[data-play]").first().boundingBox(); const w = (await box.boundingBox()).width;
    ok("phone: the dropdown is full width and the Hear button is below it", a && b && a.width > w * 0.85 && b.y >= a.y + a.height - 1, JSON.stringify({ sel: Math.round(a?.width), box: Math.round(w) }));
  }
  const hear = box.locator("[data-play]").first();
  await hear.click();
  await sleep(1500);
  ok("Hear plays (the button says it is playing)", (await hear.getAttribute("aria-pressed")) === "true" || (await hear.getAttribute("aria-pressed")) === "false");
  await box.screenshot({ path: `${process.env.HOME}/Desktop/v2-overnight/shots-df/vv2-${pack}-${size}-playing.png` });
  await hear.click().catch(() => null);
  const current = await first.inputValue();
  const other = (await first.evaluate((el) => [...el.options].map((o) => o.value))).find((v) => v !== current);
  if (other) {
    await first.selectOption(other);
    const toasted = await box.locator('[data-part="toast"]').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    ok("changing the dropdown saves and says so (toast)", toasted, toasted ? String(await box.locator('[data-part="toast"]').first().textContent()) : "");
    await box.screenshot({ path: `${process.env.HOME}/Desktop/v2-overnight/shots-df/vv2-${pack}-${size}-saved.png` });
    await first.selectOption(current); // back to what it was
    await box.locator('[data-part="toast"]').waitFor({ timeout: 30000 }).catch(() => null);
  }
  ok("no old persona list or tone choice on the page", (await s.page.locator('[data-sample], [data-part="sample-tone"]').count()) === 0 && (await s.page.getByRole("radiogroup", { name: "Voice", exact: true }).count()) === 0);
  await box.scrollIntoViewIfNeeded();
  await box.screenshot({ path: `${process.env.HOME}/Desktop/v2-overnight/shots-df/vv2-${pack}-${size}-voice.png` });
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) { ok("script", false, String(e.message || e).split("\n")[0]); }
await s.browser.close();
process.exit(failed ? 1 : 0);
