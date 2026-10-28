// "Talk to your assistant" in the browser, on staging, with a FAKE microphone: Chromium plays a recorded question into getUserMedia (no real person speaks). As a synthetic demo owner, through https://staging.stack19.com.
//   node e2e/staging-browser-voice.mjs [textiles|construction_materials|education]
// Needs BROWSER_VOICE=1 on the web and BROWSER_VOICE_ENABLED=true on the API (C1's PR 160). The question is made with macOS `say` and kept in the scratch folder, never in the repo. Made-up data only; the usage is a few seconds of speech.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SHOTS, session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const dir = mkdtempSync(path.join(os.tmpdir(), "bv-"));
const aiff = path.join(dir, "q.aiff");
const wav = path.join(dir, "q.wav");
execFileSync("say", ["-o", aiff, "How much is a silk saree, and can I come and see it today?"]);
execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);

let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"] });
const s = await session(pack, "desktop", { browser });
const csp = [];
s.page.on("console", (m) => /content security policy|refused to connect/i.test(m.text()) && csp.push(m.text().slice(0, 200)));
try {
  await s.context.grantPermissions(["microphone"], { origin: "https://staging.stack19.com" });
  await s.page.goto(`${s.base}/customers`, { waitUntil: "domcontentloaded" });
  const orb = s.page.locator('[data-ask="orb"]');
  await orb.waitFor({ timeout: 45000 });
  await orb.click();
  const chat = s.page.locator('[data-part="voice-chat"]');
  await chat.waitFor({ timeout: 20000 });
  ok("the orb opens the voice chat", true);
  await chat.locator('[data-voice="orb"]').click();
  await s.page.waitForFunction(() => /listening|thinking|speaking/.test(document.querySelector('[data-part="voice-chat"]')?.getAttribute("data-state") || ""), null, { timeout: 30000 });
  ok("the socket opened and the assistant is listening, thinking or speaking (no CSP block)", csp.length === 0, csp.join(" | "));
  await shot(s, `bv-${pack}-1-live`);
  await chat.locator('[data-who="user"]').first().waitFor({ timeout: 60000 }).then(() => ok("a caption of what was said appears", true), () => ok("a caption of what was said appears", false));
  await chat.locator('[data-who="assistant"]').first().waitFor({ timeout: 90000 }).then(() => ok("a caption of the answer appears", true), () => ok("a caption of the answer appears", false));
  await sleep(4000);
  await shot(s, `bv-${pack}-2-answer`);
  await chat.locator('[data-voice="orb"]').click();
  await s.page.getByText(/The chat has ended/).waitFor({ timeout: 15000 }).then(() => ok("a second tap ends it in plain words", true), () => ok("a second tap ends it in plain words", false));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `bv-${pack}-FAIL`).catch(() => null);
}
await s.browser.close();
console.log(`pictures in ${SHOTS}`);
process.exit(failed ? 1 : 0);
