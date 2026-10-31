// "How should I address you?" in Settings > My profile on staging, as a synthetic demo owner (C1's address_as on /me/profile). Staging only.
//   node e2e/staging-address-as.mjs [textiles|construction_materials|education] [desktop|phone]
// The field is there, a word is saved and shows after a reload, and an empty value clears it (left as it was found).
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, size);
const p = s.page;
const open = async () => {
  await p.goto(`${s.base}/settings?section=profile`, { waitUntil: "domcontentloaded" });
  await p.locator("#me-name").waitFor({ timeout: 45000 });
  await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(2000); // (hydrated: a form submitted before that is a plain page load)
};
try {
  await open();
  const has = (await p.locator("#me-address").count()) === 1;
  ok("the field 'How should I address you?' is on My profile", has);
  if (has) {
    const before = await p.locator("#me-address").inputValue();
    ok("it allows at most 30 characters", (await p.locator("#me-address").getAttribute("maxlength")) === "30");
    if (!(await p.locator("#me-name").inputValue())) await p.locator("#me-name").fill("Lakshmi Prasad"); // (the name box is required; a demo owner without a name could not save anything)
    await p.locator("#me-address").fill("Meera garu");
    await shot(s, `aa-${pack}-${size}-1-filled`, { fullPage: false });
    await p.locator('[data-part="my-profile"] form:has(#me-name) button[type="submit"]').click();
    await p.locator('[data-part="my-profile"] [role="status"]').first().waitFor({ timeout: 20000 });
    ok("saving says it is saved", true);
    await open();
    ok("the word is still there after a reload", (await p.locator("#me-address").inputValue()) === "Meera garu");
    await p.locator("#me-address").fill(before);
    await p.locator('[data-part="my-profile"] form:has(#me-name) button[type="submit"]').click();
    await p.locator('[data-part="my-profile"] [role="status"]').first().waitFor({ timeout: 20000 });
    await open();
    ok("it is put back as it was found", (await p.locator("#me-address").inputValue()) === before, JSON.stringify(before));
  }
} finally {
  await s.browser?.close?.();
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
