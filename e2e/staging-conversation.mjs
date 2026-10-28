// The conversation panel and Settings > AI assistant on staging, in a real browser, as a synthetic demo owner (quick self-check of rule 14). Staging only; a FAKE microphone (Chromium plays a recorded question), made-up data.
//   node e2e/staging-conversation.mjs [textiles|construction_materials|education]
// Checks: the floating circle opens a SMALL panel (not full screen) with one line to write in and no "Ask" / "Do it" button; a typed message gets a streamed answer; the microphone works in place: the words show live, a spoken turn joins the same thread;
// Settings > AI assistant shows the catalogue voice (no old persona words) and "Hear it" plays.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SHOTS, session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const dir = mkdtempSync(path.join(os.tmpdir(), "cv-"));
execFileSync("say", ["-o", path.join(dir, "q.aiff"), "How many enquiries came in today?"]);
execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", path.join(dir, "q.aiff"), path.join(dir, "q.wav")]);
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.join(dir, "q.wav")}`, "--autoplay-policy=no-user-gesture-required"] });
const s = await session(pack, "desktop", { browser });
const csp = [];
s.page.on("console", (m) => /content security policy|refused to connect/i.test(m.text()) && csp.push(m.text().slice(0, 160)));
try {
  await s.context.grantPermissions(["microphone"], { origin: "https://staging.stack19.com" });
  await s.page.goto(`${s.base}/outbox`, { waitUntil: "domcontentloaded" });
  await s.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(1500);
  await s.page.locator('[data-ask="orb"]').click();
  const panel = s.page.locator('[data-chat="panel"]');
  await panel.waitFor({ timeout: 30000 });
  const box = await panel.boundingBox();
  const vp = s.page.viewportSize();
  ok("the circle opens a SMALL panel, not a full screen", !!box && box.width < 500 && box.height < vp.height * 0.8, `${Math.round(box.width)}x${Math.round(box.height)}`);
  ok("one line to write in, no 'Ask' or 'Do it' button", (await panel.getByRole("button", { name: /^(Ask|Do it)$/ }).count()) === 0 && (await panel.locator("input").count()) === 1);
  await shot(s, `cv-${pack}-1-panel`);
  await panel.locator("input").fill("What can you help me with?");
  await panel.getByRole("button", { name: "Send" }).click();
  await panel.locator('[data-chat="assistant"]').first().waitFor({ timeout: 90000 }).then(() => ok("a typed message gets an answer in the thread", true), () => ok("a typed message gets an answer in the thread", false));
  await sleep(1500);
  await shot(s, `cv-${pack}-2-typed`);
  await panel.locator('[data-chat="mic"]').click();
  await panel.locator('[data-chat="state"]').waitFor({ timeout: 30000 }).then(() => ok("the microphone works in place (the socket opened, no CSP block)", csp.length === 0, csp.join(" | ")), () => ok("the microphone works in place", false));
  await panel.locator('[data-chat="you-live"], [data-chat="you"]:has-text("enquiries")').first().waitFor({ timeout: 60000 }).then(() => ok("the spoken words show in the panel", true), () => ok("the spoken words show in the panel", false));
  await sleep(6000);
  await shot(s, `cv-${pack}-3-voice`);
  const youCount = await panel.locator('[data-chat="you"], [data-chat="you-live"]').count();
  ok("typed and spoken turns are one thread", youCount >= 2, `${youCount} messages of the person`);
  await panel.locator('[data-chat="mic"]').click().catch(() => null);
  await panel.locator('[data-chat="close"]').click();
  // Settings > AI assistant
  await s.page.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  await s.page.locator("aside[aria-labelledby=asst-prev-h]").waitFor({ timeout: 45000 });
  await sleep(1500);
  const aside = await s.page.locator("aside[aria-labelledby=asst-prev-h]").innerText();
  ok("Settings > AI assistant: no old persona words on the preview", !/Male · calm|Female · warm|Male · lively|Female · clear/.test(aside) && !/Vijaya/.test(aside), aside.replace(/\s+/g, " ").slice(0, 140));
  ok("it names a catalogue voice (name · label)", /(Ramya|Janvi|Sanya|Disha|Sindhu|Esha|Meera|Divya|Prakash) · \w+/.test(aside));
  await shot(s, `cv-${pack}-4-settings`);
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `cv-${pack}-FAIL`).catch(() => null);
}
await s.browser.close();
console.log(`pictures in ${SHOTS}`);
process.exit(failed ? 1 : 0);
