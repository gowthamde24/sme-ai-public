// The spoken conversation in the chat BUBBLE (the floating circle's small panel) and in Today's card, on staging, with a FAKE microphone: Chromium plays a recorded question into getUserMedia (no real person speaks). Synthetic demo owner; staging only.
//   node e2e/staging-chat-bubble.mjs [textiles|construction_materials|education] [desktop|phone] [en|te]
// Checks (owner, 29 Oct): never full screen (no "I'm listening… Done / Never mind" view); the panel is a small bubble (desktop about 380 by 560 above the circle) or a bottom sheet of about 60 % (phone) with the page visible behind; the words show LIVE while speaking
// (more than one interim value, or a waveform until the first words); the turn ends on a pause by itself (no Done pressed); the reply streams as text in the same thread; the mic in Today's card works in place; a tap on the mic ends the chat.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SHOTS, session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
const lang = process.argv[4] || "en";
const dir = mkdtempSync(path.join(os.tmpdir(), "bb-"));
const aiff = path.join(dir, "q.aiff");
const wav = path.join(dir, "q.wav");
execFileSync("say", lang === "te" ? ["-v", "Geeta", "-o", aiff, "ఈ రోజు ఎన్ని విచారణలు వచ్చాయి, నేను ఎవరికి ముందు కాల్ చేయాలి?"] : ["-o", aiff, "How many enquiries came in today, and who should I call first?"]);
const raw = path.join(dir, "raw.wav");
execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, raw]);
// the assistant greets first and the fake microphone plays from the moment it is opened: 14 s of silence in front, so the question comes after the greeting
const q = readFileSync(raw);
const at = q.indexOf("data"); // afconvert may put other chunks before the samples: take the samples, write a clean 44-byte header
const pcm = q.subarray(at + 8, at + 8 + q.readUInt32LE(at + 4));
const body = Buffer.concat([Buffer.alloc(16000 * 2 * 14), pcm]);
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
writeFileSync(wav, Buffer.concat([head, body]));

let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
const s = await session(pack, size, { browser });
const p = s.page;
const csp = [];
p.on("console", (m) => /content security policy|refused to connect/i.test(m.text()) && csp.push(m.text().slice(0, 200)));

/** Starts the mic inside `root`, watches the live words, waits for the reply WITHOUT pressing anything, then ends the chat with a tap. */
async function talk(root, tag) {
  const mic = root.locator('[data-chat="live-talk"]');
  await mic.waitFor({ timeout: 30000 });
  await mic.click();
  const seen = new Set();
  let waved = false;
  let sawFull = false;
  const t0 = Date.now();
  let replied = false;
  while (Date.now() - t0 < 90000) {
    const live = (await root.locator("#chat-input").inputValue().catch(() => "")) || "";
    if (live) seen.add(live);
    const you = await root.locator('[data-chat="you-live"]').first().textContent({ timeout: 300 }).catch(() => null);
    if (you) seen.add(you.trim());
    if (await root.locator('[data-chat="wave"]').count()) waved = true;
    if (await p.getByRole("button", { name: /^(Done|Never mind)$/ }).count()) sawFull = true;
    const said = (await root.locator('[data-chat="you"]').count()) > 0;
    if (said && (await root.locator('[data-chat="assistant"], [data-chat="assistant-live"]').count()) > 1) { // the greeting is the first bubble; the reply is the next
      replied = true;
      break;
    }
    await sleep(150);
  }
  console.log(`${tag}: interim values seen: ${[...seen].map((v) => JSON.stringify(v)).join(" -> ")}`);
  ok(`${tag}: no "Done" / "Never mind" full-screen view`, !sawFull);
  ok(`${tag}: the words show live (a waveform until the first words, then the words)`, waved || seen.size >= 1, `waveform=${waved} values=${seen.size}`);
  ok(`${tag}: more than one live value (word by word) or the final words in the thread`, seen.size >= 2 || (await root.locator('[data-chat="you"]').count()) > 0, `values=${seen.size}`);
  ok(`${tag}: the turn ended on a pause by itself and the reply came as text in the thread`, replied);
  await sleep(6000); // the reply goes on streaming and the assistant listens again: the thread settles
  await shot(s, `bb-${pack}-${size}-${tag}-reply`);
  const you = await root.locator('[data-chat="you"]').allTextContents();
  ok(`${tag}: what was said joined the thread as ONE bubble (no interim+final twice)`, you.length === 1, `${you.length} bubble(s): ${you.join(" | ").slice(0, 160)}`);
  const said = await root.locator('[data-chat="assistant"]').evaluateAll((els) => els.map((e) => e.innerText));
  const reply = said.at(-1) || "";
  console.log(`${tag}: reply: ${JSON.stringify(reply.replace(/\s*Copy\s*$/, "").slice(0, 300))}`);
  ok(`${tag}: the reply is one text (no break inside a word or a Telugu letter)`, !/[A-Za-z]\n+[a-z]/.test(reply) && !/[\u0C00-\u0C7F]\n+[\u0C3E-\u0C4D]/.test(reply) && !/(^|\n)[\u0C3E-\u0C4D\u0C01-\u0C03]/.test(reply), "");
  ok(`${tag}: no "chat has ended" line while the panel is in use`, (await p.getByText(/chat has ended|Tap the circle/).count()) === 0);
  await mic.click().catch(() => null);
  await sleep(800);
}

try {
  await s.context.grantPermissions(["microphone"], { origin: "https://staging.stack19.com" });
  if (lang !== "en") await s.context.addCookies([{ name: "sme_lang", value: lang, url: "https://staging.stack19.com" }]);
  // 1. the circle's bubble, on a screen other than Today
  await p.goto(`${s.base}/outbox`, { waitUntil: "domcontentloaded" });
  const orb = p.locator('[data-ask="orb"]');
  await orb.waitFor({ timeout: 45000 });
  await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(1500);
  await orb.click();
  const panel = p.locator('[data-chat="panel"]');
  await panel.waitFor({ timeout: 30000 });
  const vp = p.viewportSize();
  const box = await panel.boundingBox();
  if (size === "desktop") {
    ok("desktop: a small bubble (about 380 by 560), not full screen", box && box.width <= 400 && box.height <= 600 && box.x > vp.width / 2, JSON.stringify(box && { w: Math.round(box.width), h: Math.round(box.height) }));
    ok("desktop: it sits above the circle (bottom right)", box && box.y + box.height < vp.height - 40);
  } else {
    ok("phone: a bottom sheet of about 60 % with the page visible above it", box && Math.abs(box.height / vp.height - 0.6) < 0.1 && box.y > vp.height * 0.3, JSON.stringify(box && { h: Math.round(box.height), vh: vp.height }));
  }
  await shot(s, `bb-${pack}-${size}-1-bubble`);
  await talk(panel, "bubble");
  await panel.locator('[data-chat="close"]').click();
  // 2. Today's card: the mic works in place
  await p.goto(s.base, { waitUntil: "domcontentloaded" });
  const card = p.locator('[data-chat="card"]');
  await card.waitFor({ timeout: 45000 });
  await sleep(1500);
  ok("Today: the chat is in the assistant's card (in place, no dialog)", (await p.getByRole("dialog").count()) === 0);
  await shot(s, `bb-${pack}-${size}-2-card`);
  await talk(card, "card");
  ok("no content-security-policy block for the socket", csp.length === 0, csp.join(" | "));
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `bb-${pack}-${size}-FAIL`).catch(() => null);
}
await s.browser.close();
console.log(`pictures in ${SHOTS}`);
process.exit(failed ? 1 : 0);
