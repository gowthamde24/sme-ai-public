// Full-page pictures of Today (the cards two by two below the assistant row), light and dark, 1440x900 and 390 phone. Staging only.
//   node e2e/staging-today-full.mjs [textiles|construction_materials|education] [en|te]
import { session, shot } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const lang = process.argv[3] || "en";
const s = await session(pack, "desktop");
for (const theme of ["light", "dark"]) {
  const cookies = [{ name: "sme_theme", value: theme, url: "https://staging.stack19.com" }];
  if (lang !== "en") cookies.push({ name: "sme_lang", value: lang, url: "https://staging.stack19.com" });
  await s.context.addCookies(cookies);
  await s.page.setViewportSize({ width: 1440, height: 900 });
  await s.page.goto(s.base, { waitUntil: "domcontentloaded" });
  await s.page.locator('[data-chat="bar"]').waitFor({ timeout: 45000 });
  await s.page.waitForTimeout(2500);
  await shot(s, `tf-${pack}-${lang}-${theme}-1440`, { fullPage: true });
}
await s.browser.close();
