// Pictures of Today for the owner's review (31 Oct): light and dark at 1366x768 and 1440x900, and a 390 phone. Staging only.
//   node e2e/staging-today-shots.mjs [textiles|construction_materials|education] [en|te]
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const lang = process.argv[3] || "en";
const s = await session(pack, "desktop");
const p = s.page;
for (const theme of ["light", "dark"]) {
  const cookies = [{ name: "sme_theme", value: theme, url: "https://staging.stack19.com" }];
  if (lang !== "en") cookies.push({ name: "sme_lang", value: lang, url: "https://staging.stack19.com" });
  await s.context.addCookies(cookies);
  for (const [w, h] of [[1366, 768], [1440, 900], [390, 844]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(s.base, { waitUntil: "domcontentloaded" });
    await p.locator('[data-screen="today"] h1').waitFor({ timeout: 45000 });
    await p.locator('[data-live="pill"]').waitFor({ timeout: 30000 }).catch(() => null);
    await sleep(2500);
    await shot(s, `ts-${pack}-${lang}-${theme}-${w}`, { fullPage: false });
    console.log(`shot ${theme} ${w}x${h}`);
  }
}
await s.browser.close();
