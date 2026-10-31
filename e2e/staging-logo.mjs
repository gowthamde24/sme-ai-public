// The business logo in the menu and "Powered by Stack19" (owner 31 Oct), on staging as a synthetic demo owner. Staging only.
//   node e2e/staging-logo.mjs [textiles|construction_materials|education] [en|te]
// Without a logo the top of the menu is a letter avatar of the business name in brand colours; after uploading one in Settings > Business > Logo it becomes the picture at once (no reload); removing it brings the letters back. "Powered by Stack19" (the three-bar mark and
// the words) sits at the bottom of the menu, and in the phone's More sheet. Also: the Live now pill is on the greeting row, right-aligned (under the greeting on a phone), not in the top bar; the greeting carries the member's name. Pictures: ~/Desktop/v2-overnight/shots-df/.
import zlib from "node:zlib";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const lang = process.argv[3] || "en";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
/** A small square PNG with a coloured block in the middle (enough to see that the picture is the picture). */
function png(size, [r, g, b]) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: size }, (_, x) => Buffer.from(x > size * 0.2 && x < size * 0.8 ? [r, g, b] : [255, 255, 255])))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const file = path.join(mkdtempSync(path.join(os.tmpdir(), "logo-")), "logo.png");
writeFileSync(file, png(96, [194, 65, 12]));
const s = await session(pack, "desktop");
const p = s.page;
try {
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  await p.setViewportSize({ width: 1366, height: 768 });
  // the member's name (the demo owner has none): the greeting uses it
  await p.goto(`${s.base}/settings?section=profile`, { waitUntil: "domcontentloaded" });
  await p.locator("#me-name").waitFor({ timeout: 45000 });
  let memberName = await p.locator("#me-name").inputValue();
  if (!memberName) {
    memberName = "Gowtham Reddy";
    await p.locator("#me-name").fill(memberName);
    await p.locator('[data-part="my-profile"] form:has(#me-name) button[type="submit"]').click();
    await sleep(2500);
  }
  await p.goto(`${s.base}/settings?section=business`, { waitUntil: "domcontentloaded" });
  await p.locator("#biz-logo-file").waitFor({ timeout: 45000 });
  const removeBtn = p.locator('form:has(input[name="remove"]) button');
  if ((await removeBtn.count()) > 0) {
    await removeBtn.first().click();
    await p.locator('aside [data-business-logo="letters"]').waitFor({ timeout: 30000 });
  }
  await sleep(1500);
  const letters = (await p.locator('aside [data-business-logo="letters"]').innerText()).trim();
  ok("with no logo: a letter avatar of the business name", /^\S{1,4}$/u.test(letters), letters);
  const bg = await p.locator('aside [data-business-logo="letters"]').evaluate((e) => getComputedStyle(e).backgroundColor);
  ok("…in the brand colour", !/rgba?\(0, 0, 0, 0\)/.test(bg), bg);
  await shot(s, `lg-${pack}-${lang}-1-letters`, { fullPage: false });
  await p.locator("#biz-logo-file").setInputFiles(file);
  await p.locator('form:has(#biz-logo-file) button[type="submit"]').first().click();
  await p.locator('aside [data-business-logo="image"]').waitFor({ timeout: 40000 });
  ok("after the upload the menu shows the logo at once (no reload)", (await p.locator('aside [data-business-logo="image"]').count()) === 1);
  await p.waitForFunction(() => { const e = document.querySelector('aside [data-business-logo="image"]'); return !e || (e.complete && e.naturalWidth > 0); }, null, { timeout: 15000 }).catch(() => null);
  const imgState = await p.locator('aside [data-business-logo="image"]').evaluate((e) => ({ loaded: e.complete && e.naturalWidth > 0, src: e.src.replace(/\?.*/, "").slice(-60) })).catch(() => ({ loaded: false, src: "(no image: it fell back to the letters)" }));
  ok("…and the picture loads", imgState.loaded, imgState.src);
  await sleep(800);
  await shot(s, `lg-${pack}-${lang}-2-logo`, { fullPage: false });
  const pw = (await p.locator('aside [data-frame="powered-by"]').innerText()).trim();
  const pwBox = await p.locator('aside [data-frame="powered-by"]').evaluate((e) => ({ bottomGap: document.querySelector("aside").getBoundingClientRect().bottom - e.getBoundingClientRect().bottom, hasMark: !!e.querySelector("svg") }));
  ok("'Powered by Stack19' with the three-bar mark at the bottom of the menu", /Stack19/.test(pw) && pwBox.bottomGap < 40 && pwBox.hasMark, `${pw} gap=${Math.round(pwBox.bottomGap)}`);
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator('[data-screen="today"] h1').waitFor({ timeout: 45000 });
  await p.locator('[data-live="pill"]').waitFor({ timeout: 30000 }).catch(() => null);
  await sleep(1500);
  const g = await p.evaluate(() => {
    const h1 = document.querySelector('[data-screen="today"] h1').getBoundingClientRect();
    const pillEl = document.querySelector('[data-live="pill"]');
    const pill = pillEl?.getBoundingClientRect();
    const main = document.querySelector("main").getBoundingClientRect();
    return { h1: document.querySelector('[data-screen="today"] h1').innerText, inHeader: !!document.querySelector('header[class*="sticky"] [data-live="pill"]'), sameRow: !!pill && pill.bottom > h1.top && pill.top < h1.bottom + 40, rightAligned: !!pill && main.right - pill.right < 60 };
  });
  ok("the Live now pill is on the greeting row, right-aligned, not in the top bar", !g.inHeader && g.sameRow && g.rightAligned, JSON.stringify(g));
  ok("the greeting carries the member's name, with the language's respectful form", lang === "te" ? g.h1.endsWith(`${memberName} గారు`) : g.h1.endsWith(`, ${memberName}`), g.h1.replace(/\n/g, " "));
  await shot(s, `lg-${pack}-${lang}-3-today`, { fullPage: false });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  await p.locator('[data-screen="today"] h1').waitFor({ timeout: 45000 });
  await sleep(2000);
  const ph = await p.evaluate(() => {
    const h1 = document.querySelector('[data-screen="today"] h1').getBoundingClientRect();
    const pill = document.querySelector('[data-live="pill"]')?.getBoundingClientRect();
    return { below: !pill || pill.top >= h1.bottom - 2, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, headerHasPill: !!document.querySelector('header[class*="sticky"] [data-live="pill"]') };
  });
  ok("phone: the pill is under the greeting, nothing in the header, no sideways scroll", ph.below && !ph.headerHasPill && ph.scrollW <= ph.innerW + 1, JSON.stringify(ph));
  await shot(s, `lg-${pack}-${lang}-4-phone`, { fullPage: false });
  await p.getByRole("button", { name: /^(More|మరిన్ని)/ }).click().catch(() => null);
  await sleep(700);
  ok("phone: 'Powered by Stack19' in the More sheet", (await p.locator('[data-frame="powered-by"]').filter({ visible: true }).count()) >= 1);
  await shot(s, `lg-${pack}-${lang}-5-phone-more`, { fullPage: false });
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.goto(`${s.base}/settings?section=business`, { waitUntil: "domcontentloaded" });
  await p.locator("#biz-logo-file").waitFor({ timeout: 45000 });
  const rm = p.locator('form:has(input[name="remove"]) button');
  if ((await rm.count()) > 0) {
    await rm.first().click();
    await p.locator('aside [data-business-logo="letters"]').waitFor({ timeout: 30000 });
  }
  ok("removing the logo brings the letters back at once", (await p.locator('aside [data-business-logo="letters"]').count()) === 1);
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 220));
}
await s.browser.close();
process.exit(failed ? 1 : 0);
