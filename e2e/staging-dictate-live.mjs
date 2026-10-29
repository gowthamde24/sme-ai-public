// The chat's input bar on staging: Dictate (words into the text box, then Send, reply as text) and Live talk (hands-free, a Live indicator and Stop), with a FAKE microphone (Chromium plays a recorded question). Synthetic demo owner. Staging only.
//   node e2e/staging-dictate-live.mjs [textiles|construction_materials|education] [desktop|phone] [en|te]
// Dictate: the Dictate button fills the box with the words (editable), nothing is asked until Send, no spoken answer (no socket), the reply is text. Live: the Live indicator and Stop show, the words and the reply appear in the SAME thread
// as the typed message, it ends on Stop. Pictures in ~/Desktop/v2-overnight/shots-df/.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SHOTS, session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
const lang = process.argv[4] || "en";
const dir = mkdtempSync(path.join(os.tmpdir(), "dl-"));
const aiff = path.join(dir, "q.aiff");
const raw = path.join(dir, "raw.wav");
execFileSync("say", lang === "te" ? ["-v", "Geeta", "-o", aiff, "ఈ రోజు ఎన్ని విచారణలు వచ్చాయి, నేను ఎవరికి ముందు కాల్ చేయాలి?"] : ["-o", aiff, "How many enquiries came in today, and who should I call first?"]);
execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, raw]);
const q = readFileSync(raw);
const at = q.indexOf("data");
const pcm = q.subarray(at + 8, at + 8 + q.readUInt32LE(at + 4));
/** The fake microphone file: `lead` seconds of silence, the question, then silence (it plays once from the moment the microphone opens). */
function wavWith(lead, tail, name) {
  const body = Buffer.concat([Buffer.alloc(16000 * 2 * lead), pcm, Buffer.alloc(16000 * 2 * tail)]);
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
  const file = path.join(dir, name);
  writeFileSync(file, Buffer.concat([head, body]));
  return { file, seconds: lead + pcm.length / 32000 + tail };
}
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const launch = (file) => chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${file}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
async function open(file) {
  const browser = await launch(file);
  const s = await session(pack, size, { browser });
  await s.context.grantPermissions(["microphone"], { origin: "https://staging.stack19.com" });
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  const sockets = [];
  s.page.on("websocket", (w) => sockets.push(w.url()));
  await s.page.goto(s.base, { waitUntil: "domcontentloaded" });
  const card = s.page.locator('[data-chat="card"]');
  await card.waitFor({ timeout: 45000 });
  await sleep(1500);
  return { s, card, sockets };
}

try {
  // 1. Dictate: the question is spoken right away; tap Dictate, wait, tap again to stop
  const d = wavWith(0.5, 4, "dictate.wav");
  const D = await open(d.file);
  const { card: dc, s: ds } = D;
  const bar = dc.locator('[data-chat="form"]');
  const kinds = await bar.locator("input, button").evaluateAll((els) => els.map((e) => (e.tagName === "INPUT" ? "text" : e.getAttribute("data-chat") || e.getAttribute("type"))));
  ok("the input bar is: text box, Dictate, Live talk, Send", kinds.join() === "text,dictate,live-talk,submit", kinds.join());
  await shot(ds, `dl-${pack}-${size}-${lang}-1-bar`);
  await dc.locator('[data-chat="dictate"]').click();
  await sleep(Math.round((d.seconds - 1) * 1000));
  ok("while dictating the button says Stop and Live talk is disabled", (await dc.locator('[data-chat="dictate"]').getAttribute("aria-pressed")) === "true" && (await dc.locator('[data-chat="live-talk"]').isDisabled()));
  await dc.locator('[data-chat="dictate"]').click(); // tap again: stop early
  const box = dc.locator("#chat-input");
  const t0 = Date.now();
  let words = "";
  while (Date.now() - t0 < 45000) {
    words = await box.inputValue();
    if (words.trim() !== "") break;
    await sleep(300);
  }
  console.log(`dictated words: ${JSON.stringify(words)}`);
  ok("the words fill the TEXT BOX", words.trim().split(/\s+/).length >= 3, words.slice(0, 80));
  ok("nothing was asked by dictating (no reply yet)", (await dc.locator('[data-chat="exchange"]').count()) === 0);
  ok("no spoken conversation was opened (no socket)", D.sockets.length === 0, D.sockets.join());
  await shot(ds, `dl-${pack}-${size}-${lang}-2-dictated`);
  await box.fill(`${words.trim()} `); // the words can be edited
  await dc.locator('button[type="submit"]').click();
  const t1 = Date.now();
  let reply = "";
  while (Date.now() - t1 < 60000) {
    reply = (await dc.locator('[data-chat="assistant"]').last().innerText().catch(() => "")) || "";
    if (reply.trim().length > 20) break;
    await sleep(500);
  }
  ok("Send gives a text reply in the thread", reply.trim().length > 20, reply.replace(/\s+/g, " ").slice(0, 100));
  ok("still no socket after the reply (text only, no audio)", D.sockets.length === 0);
  await shot(ds, `dl-${pack}-${size}-${lang}-3-dictate-reply`);
  ok("dictate: no page errors", ds.errors.length === 0, ds.errors.slice(0, 2).join(" | "));
  await ds.browser.close();

  // 2. Live talk: 14 s of silence in front (the assistant greets first), then the question
  const l = wavWith(14, 6, "live.wav");
  const L = await open(l.file);
  const { card: lc, s: ls } = L;
  await lc.locator("#chat-input").fill("price of silk?");
  await lc.locator('button[type="submit"]').click();
  await lc.locator('[data-chat="assistant"]').first().waitFor({ timeout: 60000 }).catch(() => null);
  await lc.locator('[data-chat="live-talk"]').click();
  await lc.locator('[data-chat="live-badge"]').waitFor({ timeout: 30000 });
  ok("a clear Live indicator shows", (await lc.locator('[data-chat="live-badge"]').innerText()).trim().length > 0);
  ok("the Live button is now Stop", (await lc.locator('[data-chat="live-talk"]').getAttribute("aria-pressed")) === "true");
  ok("Dictate is off while live", await lc.locator('[data-chat="dictate"]').isDisabled());
  await shot(ls, `dl-${pack}-${size}-${lang}-4-live`);
  const t2 = Date.now();
  let turns = 0;
  while (Date.now() - t2 < 90000) {
    turns = await lc.locator('[data-chat="you"]').count();
    if (turns >= 2 && (await lc.locator('[data-chat="assistant"]').count()) >= 3) break;
    await sleep(500);
  }
  await sleep(4000);
  const youText = await lc.locator('[data-chat="you"]').allTextContents();
  ok("the typed message and the spoken turn are in ONE thread", turns >= 2 && youText[0].includes("price of silk"), youText.join(" | ").slice(0, 150));
  await shot(ls, `dl-${pack}-${size}-${lang}-5-live-thread`);
  await lc.locator('[data-chat="live-talk"]').click(); // Stop
  await sleep(1500);
  ok("Stop ends it (the Live indicator is gone)", (await lc.locator('[data-chat="live-badge"]').count()) === 0);
  ok("live: no page errors", ls.errors.length === 0, ls.errors.slice(0, 2).join(" | "));
  await ls.browser.close();
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
}
console.log(`pictures in ${SHOTS}`);
process.exit(failed ? 1 : 0);
