// Pronunciation on staging (rule 14 self-check), as a synthetic demo owner, PRONUNCIATION_SCREENS=mock (the list is kept in a cookie; the sounds are tones). Staging only.
//   node e2e/staging-pronunciation.mjs [textiles|construction_materials|education] [desktop|phone]
// Settings > AI assistant > Pronunciation: the business's words are offered, add a word with "sounds like", Hear it plays, Save puts a row in the list, it is still there after a reload, Remove takes it out.
// Chat: after a SPOKEN turn (Live talk, fake microphone) "Mispronounced?" shows under the assistant's reply: tap it, tap a word, type how it sounds, Save; the word is then in the Settings list.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const dir = mkdtempSync(path.join(os.tmpdir(), "pr-"));
const aiff = path.join(dir, "q.aiff");
const raw = path.join(dir, "raw.wav");
execFileSync("say", ["-o", aiff, "How many enquiries came in today, and who should I call first?"]);
execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, raw]);
const q = readFileSync(raw);
const at = q.indexOf("data");
const pcm = q.subarray(at + 8, at + 8 + q.readUInt32LE(at + 4));
const body = Buffer.concat([Buffer.alloc(16000 * 2), pcm, Buffer.alloc(16000 * 2 * 6)]);
const head = Buffer.alloc(44);
head.write("RIFF", 0);
head.writeUInt32LE(36 + body.length, 4);
head.write("WAVEfmt ", 8);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);
head.writeUInt16LE(1, 22);
head.writeUInt32LE(16000, 24);
head.writeUInt32LE(32000, 28);
head.writeUInt16LE(2, 32);
head.writeUInt16LE(16, 34);
head.write("data", 36);
head.writeUInt32LE(body.length, 40);
const wav = path.join(dir, "mic.wav");
writeFileSync(wav, Buffer.concat([head, body]));

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
const s = await session(pack, size, { browser });
const p = s.page;
const rows = () => p.locator('[data-part="pron-row"]');
try {
  await s.context.grantPermissions(["microphone"], { origin: "https://staging.stack19.com" });
  await p.goto(`${s.base}/settings?section=assistant#pronunciation`, { waitUntil: "domcontentloaded" });
  const part = p.locator('[data-part="pronunciation"]');
  await part.waitFor({ timeout: 45000 }); // (the part is in the Pronunciation tab: the #pronunciation link opens it)
  await sleep(1500);
  const title = (await part.locator("h2").textContent()) ?? "";
  ok("Settings > AI assistant has a Pronunciation part", /pronunciation/i.test(title), title);
  const have0 = await rows().count();
  const sug = await part.locator('[data-part="pron-suggest"] button').allTextContents();
  ok("the business's own words are offered (name, town)", sug.length > 0, sug.join(", ").slice(0, 80));
  await part.scrollIntoViewIfNeeded();
  await part.locator('[data-part="pron-suggest"] button').first().click();
  const word = await part.locator("#pr-word").inputValue();
  ok("tapping a suggestion fills the word", word === sug[0], word);
  await part.locator("#pr-sound").fill("test sound");
  await shot(s, `pr-${pack}-${size}-1-filled`);
  const heard = p.waitForResponse((r) => r.url().includes("/pronunciation-preview"), { timeout: 15000 });
  await part.locator('[data-part="pron-hear-new"]').click();
  const hr = await heard;
  ok("Hear it asks for the sound and gets audio", hr.status() === 200 && /audio\//.test(hr.headers()["content-type"] ?? ""), `${hr.status()} ${hr.headers()["content-type"]}`);
  await part.locator('[data-part="pron-save"]').click();
  await p.waitForFunction((n) => document.querySelectorAll('[data-part="pron-row"]').length > n, have0, { timeout: 15000 });
  ok("Save puts a row in the list", (await rows().count()) === have0 + 1);
  ok("the row says the word and how it sounds", ((await rows().last().textContent()) ?? "").includes(word) && ((await rows().last().textContent()) ?? "").includes("test sound"));
  await shot(s, `pr-${pack}-${size}-2-saved`);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.locator('[data-part="pronunciation"]').waitFor({ timeout: 45000 });
  ok("it is still there after a reload", (await rows().count()) === have0 + 1);
  await rows().last().locator('[data-part="pron-remove"]').click();
  await p.waitForFunction((n) => document.querySelectorAll('[data-part="pron-row"]').length === n, have0, { timeout: 15000 });
  ok("Remove takes it out", (await rows().count()) === have0);

  // the chat: a spoken turn, then "Mispronounced?"
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  const card = p.locator('[data-chat="card"]');
  await card.waitFor({ timeout: 45000 });
  await sleep(1500);
  await card.locator('[data-chat="live-talk"]').click();
  const t0 = Date.now();
  while (Date.now() - t0 < 90000 && (await card.locator('[data-chat="assistant-live"]').count()) === 0) await sleep(500);
  await sleep(6000);
  const spoken = card.locator('[data-chat="assistant-live"], [data-chat="assistant"]');
  ok("a spoken reply is in the thread", (await spoken.count()) > 0);
  const mis = card.locator('[data-chat="mis"]').first();
  await mis.scrollIntoViewIfNeeded();
  ok('"Mispronounced?" shows under the spoken reply', (await card.locator('[data-chat="mis"]').count()) > 0);
  if ((await card.locator('[data-chat="live-badge"]').count()) > 0) await card.locator('[data-chat="live-talk"]').click(); // Stop
  await mis.click();
  const w = card.locator('[data-chat="mis-word"]').first();
  const wtext = ((await w.textContent()) ?? "").trim();
  await w.click();
  await card.locator("#mis-sound").fill("sounds right");
  await shot(s, `pr-${pack}-${size}-3-mis`);
  await card.locator('[data-chat="mis-save"]').click();
  await card.locator('[data-chat="mis-saved"]').waitFor({ timeout: 15000 });
  ok("Save says it is saved", true);
  await p.goto(`${s.base}/settings?section=assistant#pronunciation`, { waitUntil: "domcontentloaded" });
  await p.locator('[data-part="pronunciation"]').waitFor({ timeout: 45000 });
  const texts = await rows().allTextContents();
  ok("the taught word is in the Settings list", texts.some((t) => t.includes(wtext) && t.includes("sounds right")), `${wtext}`);
  const last = rows().filter({ hasText: "sounds right" }).first();
  await last.locator('[data-part="pron-remove"]').click(); // leave nothing behind
  await sleep(800);
} finally {
  await browser.close();
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
