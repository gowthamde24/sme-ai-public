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
  ok("every row says who speaks", (await box.locator("[data-part=speaking-in]").count()) === (await box.locator("[data-voice-lang]").count()));
  ok("no old persona list or tone choice on the page", (await s.page.locator('[data-sample], [data-part="sample-tone"]').count()) === 0 && (await s.page.getByRole("radiogroup", { name: "Voice", exact: true }).count()) === 0);
  await box.scrollIntoViewIfNeeded();
  await box.screenshot({ path: `${process.env.HOME}/Desktop/v2-overnight/shots-df/vv2-${pack}-${size}-voice.png` });
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) { ok("script", false, String(e.message || e).split("\n")[0]); }
await s.browser.close();
process.exit(failed ? 1 : 0);
