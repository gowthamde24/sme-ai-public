// Approves away the later of two Needs-you rows that carry the same made-up name (staging demo data only; nothing dials), so the demo workspace reads like real people.
//   node e2e/staging-dedupe-rows.mjs [textiles|construction_materials|education]
import { session, sleep } from "./staging-df-lib.mjs";

const s = await session(process.argv[2] || "textiles", "desktop");
const p = s.page;
await p.setViewportSize({ width: 1440, height: 900 });
for (let i = 0; i < 6; i++) {
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator("#needs-you").waitFor({ timeout: 45000 });
  await sleep(2500);
  const rows = await p.locator("[data-needs-row]").allInnerTexts();
  const names = rows.map((r) => r.replace(/\s+/g, " ").replace(/^\S+\s/, "").split(" asked")[0].split(" కాల్")[0]);
  const dup = names.findIndex((n, k) => names.indexOf(n) !== k);
  console.log(JSON.stringify(names));
  if (dup < 0) break;
  await p.locator("[data-needs-row]").nth(dup).getByRole("button", { name: /^(Approve|ఓకే)/ }).first().click().catch(() => null);
  await sleep(3500);
}
await s.browser.close();
