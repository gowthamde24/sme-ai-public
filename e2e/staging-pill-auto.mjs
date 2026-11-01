// Puts the assistant's language pill of the three synthetic demo owners back to Auto (the e2e runs change and restore it; this is the safety net). Staging only.
import { PACKS, session, sleep } from "./staging-df-lib.mjs";

for (const pack of PACKS) {
  const s = await session(pack, "desktop");
  try {
    await s.page.setViewportSize({ width: 1440, height: 900 });
    await s.page.goto(s.base, { waitUntil: "domcontentloaded" });
    const sel = s.page.locator('[data-part="command-bar"] [data-chat="language"] select');
    await sel.waitFor({ timeout: 45000 });
    const before = await sel.inputValue();
    if (before !== "auto") {
      await sel.selectOption("auto");
      await sleep(2500);
      await s.page.reload({ waitUntil: "domcontentloaded" });
      await sel.waitFor({ timeout: 45000 });
    }
    console.log(`${pack}: ${before} -> ${await sel.inputValue()}`);
  } finally {
    await s.browser.close();
  }
}
