// The demo video, RECORDED (job demo-video, owner 5 Nov 2026): plays the whole 60-second story at a steady pace on the REAL web app, on the visual tests' invented backend (stand-in.mjs: no database, no keys,
// no network after the build, no real person), and records it as video at 1080x1920 (phone, for reels) and 1920x1080 (desktop). The pauses are where the voice-over talks.
//
//   node e2e/visual/demo-video-record.mjs [--no-build] [--out DIR] [--only phone|desktop] [--scheme light|dark] [--no-frames]
//
// Writes to DIR (default /Volumes/Stack19/stack19/v2-overnight/demo-video):
//   demo-video-1080x1920.webm, demo-video-1920x1080.webm   the recordings (VP8; Playwright's own encoder: the editor converts if it needs to)
//   timings-1080x1920.json, timings-1920x1080.json          when each scene starts and ends in that video (seconds), with its voice-over line (frames-*/timings.json: the same for the sharp copy)
//   scenes.md                                               the scene list with the timings of both videos (also copied to ~/Desktop/stack19-jobs/demo-video-script.md's table by hand)
//   frames-1080x1920/, frames-1920x1080/                    the SHARP copy: the page as JPEGs at full size (quality 90, 10-20 a second) + frames.ffconcat with the real timing, for the editor:
//                                                            ffmpeg -f concat -i frames.ffconcat -vsync vfr -pix_fmt yuv420p -c:v libx264 -crf 16 demo.mp4   (off with --no-frames)
//   demo-video-record.mjs                                   a copy of this script
// The web app runs with DEMO_VIDEO=on and the stand-in calls the workspace a demo one, so `?demo=video` opens the story; the script moves a drawn pointer (desktop) or a finger dot (phone) to each button before it
// presses it, because a recorded browser draws no pointer of its own. It checks that nothing but reads reached the stand-in. Same ports as run.mjs (54999, 3014); it stops only its own processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, SESSION_USER, TENANT } from "./fixtures.mjs";
import { startStandIn } from "./stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(arg("out", "/Volumes/Stack19/stack19/v2-overnight/demo-video"));
const ONLY = arg("only", "");
const SCHEME = arg("scheme", "light");
const FRAMES = !process.argv.includes("--no-frames"); // the sharp frame-by-frame copy next to each video (on unless --no-frames)
const STAND_IN_PORT = 54999;
const WEB_PORT = 3014;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const URL_VIDEO = `${WEB_URL}/app/tenants/${TENANT}?demo=video`;

// the two recordings: the page is laid out at a phone's or a laptop's width and drawn at a higher pixel density, so the video is sharp at its full size
const RUNS = [
  { id: "phone", label: "1080x1920", viewport: { width: 432, height: 768 }, scale: 2.5, video: { width: 1080, height: 1920 }, mobile: true },
  { id: "desktop", label: "1920x1080", viewport: { width: 1440, height: 810 }, scale: 4 / 3, video: { width: 1920, height: 1080 }, mobile: false },
].filter((r) => !ONLY || r.id === ONLY);

/**
 * The story at a steady pace. Each scene: what must be on screen first (`wait`), how long it is held for the voice-over (`hold`, ms), then how it moves on: `click` (the pointer goes to that button and presses it),
 * `key` (the presenter's next key, for a beat without a button) or nothing (the story moves on by itself). `vo` is the suggested voice-over line.
 */
const SCENES = [
  { id: "1-today", wait: '[data-dv-beat="today"] [data-screen="today"]', hold: 4500, key: true, vo: "This is Today: everything your business needs from you, in one place." },
  { id: "2-whatsapp-lead", wait: '[data-dv-beat="lead"] [data-needs-row^="outbox_approval-"]', hold: 3500, click: '[data-needs-row^="outbox_approval-"] [title]', vo: "A new enquiry on WhatsApp: Lakshmi wants 40 silk sarees." },
  { id: "3-telugu-reply", wait: '[data-dv-beat="reply"] [data-part="gloss"]', hold: 6000, click: '[id^="needs-full-"] [data-needs="approve"]', vo: "The assistant has already replied in Telugu, with prices from your own catalogue. Anything about money waits for your OK." },
  { id: "4-approved-chat", wait: '[data-dv-beat="sent"]', then: '[data-dv-beat="chat"][data-dv-answered]', hold: 3800, key: true, vo: "One tap: sent. And Lakshmi answers straight away." },
  { id: "5a-ask-lead-finder", wait: '[data-dv-beat="finder"] [data-finder]', until: async (page) => (await page.locator("[data-finder] input").inputValue()) === "find new boutiques in Jayanagar, Bengaluru", hold: 700, click: "[data-finder] button[type=submit]", vo: "Need more buyers? Ask: find new boutiques in Jayanagar, Bengaluru." },
  { id: "5b-plan-card", wait: '[data-dv-beat="plan"] [data-plan-card]', hold: 3800, click: "[data-plan-ok]", vo: "It shows the plan and the cost first. You say OK." },
  { id: "5c-results", wait: '[data-dv-beat="found"] [data-result-card]', hold: 5000, key: true, vo: "Sixteen boutiques found: five ready to call, three that need you, best fit first." },
  { id: "6-practice-call", wait: '[data-dv-beat="call"] [data-practice] > summary', hold: 300, click: "[data-practice] > summary", vo: "Before calling anyone, practise: the assistant talks to a simulated shop owner." },
  { id: "6a-start-call", wait: '[data-dv-beat="start"] [data-practice-start]', hold: 600, click: "[data-practice-start]", vo: "(the same line goes on: the call is talking)" },
  { id: "6b-call-result", wait: "[data-practice-result]", hold: 5500, then: "[data-draft-make]", click: "[data-draft-make]", vo: "Qualified: about 25 Kanchi and 15 Banarasi, and she wants the quote on WhatsApp." },
  { id: "7-draft-quote", wait: '[data-dv-beat="made"] [data-draft-made]', hold: 3200, click: "[data-draft-open]", vo: "The quote is drafted at your catalogue prices. Nothing goes out without you." },
  { id: "8-done-while-you-slept", wait: '[data-dv-beat="done"] [data-part="done"]', hold: 6000, vo: "And every morning: here's what was done while you slept." },
];

/** The pointer a recording does not draw by itself: an arrow on a laptop, a finger dot on a phone. It follows the mouse the script moves, shrinks a little on a press, and takes no clicks. */
const pointerScript = (phone) => `(() => {
  const add = () => {
    if (document.getElementById("dv-pointer")) return;
    const c = document.createElement("div");
    c.id = "dv-pointer";
    c.setAttribute("aria-hidden", "true");
    const size = ${phone ? 46 : 24};
    Object.assign(c.style, { position: "fixed", left: "-100px", top: "-100px", width: size + "px", height: size + "px", marginLeft: "${phone ? "-23px" : "-3px"}", marginTop: "${phone ? "-23px" : "-2px"}", zIndex: "2147483647", pointerEvents: "none", transition: "transform 110ms ease-out" });
    c.innerHTML = ${phone ? `'<div style="width:100%;height:100%;border-radius:50%;background:rgba(30,30,30,.22);border:2px solid rgba(255,255,255,.95);box-shadow:0 1px 8px rgba(0,0,0,.35)"></div>'` : `'<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.6 14.8 L10.8 21.6 L13.7 20.4 L10.6 13.7 L16.8 13.7 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'`};
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { c.style.transform = "scale(0.8)"; }, true);
    addEventListener("mouseup", () => { c.style.transform = "scale(1)"; }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();`;

const b64url = (s) => Buffer.from(s).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("visual-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800 });
  const session = { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "visual-refresh", user: SESSION_USER };
  return `base64-${b64url(JSON.stringify(session))}`;
}
const connect = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
async function waitForPort(port, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await connect(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port} after ${ms} ms`);
}

// the API's own word that this is a demo workspace (the guard's third question)
const extraRoutes = [
  [
    "GET",
    new RegExp(`^/v1/tenants/${TENANT}/billing/access$`),
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ access: "full", read_only_since: null, delete_on: null, data_days_left: null, can_resume: false, sending: "on", waiting_for: null, demo: true }));
    },
  ],
];

/** The pointer glides to the middle of `selector` (once the page has stopped scrolling it into view) and presses it. */
async function pressAt(page, selector, mouse) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 15_000 });
  let box = null;
  for (let i = 0; i < 30; i++) {
    const a = await el.boundingBox();
    await page.waitForTimeout(90);
    const b = await el.boundingBox();
    const vh = page.viewportSize().height;
    if (a && b && Math.abs(a.y - b.y) < 0.5 && b.y >= 56 && b.y + Math.min(b.height, 60) <= vh - 8) {
      box = b;
      break;
    }
    if (i === 8 && b && (b.y < 56 || b.y + Math.min(b.height, 60) > vh - 8)) await el.evaluate((n) => n.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
  if (!box) box = await el.boundingBox();
  const x = box.x + Math.min(box.width / 2, 120);
  const y = box.y + Math.min(box.height / 2, 22);
  await page.mouse.move(x, y, { steps: Math.max(12, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 18)) });
  mouse.x = x;
  mouse.y = y;
  await page.waitForTimeout(220);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

async function record(browser, run, cookie, tmp, sharp) {
  // two passes per size: the video (Playwright records it), then the sharp copy (screenshots one after another; the two would fight over the page if run together)
  const dir = path.join(tmp, `${run.id}-${sharp ? "frames" : "video"}`);
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: run.viewport, deviceScaleFactor: run.scale, colorScheme: SCHEME, reducedMotion: "no-preference", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: run.mobile, hasTouch: run.mobile, ...(sharp ? {} : { recordVideo: { dir, size: run.video } }) });
  await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: "en", url: WEB_URL }, { name: "sme_theme", value: SCHEME, url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
  await context.addInitScript(pointerScript(run.mobile));
  const page = await context.newPage();
  const t0 = Date.now(); // the video starts with the page
  // the sharp copy: the page as JPEGs at the video's full size, each with its time (Playwright's own video is drawn at the layout size and scaled up: soft, about 0.7 Mbit/s)
  const framesDir = path.join(OUT, `frames-${run.label}`);
  const frames = [];
  let cdp = false;
  let capturing = false;
  let missed = 0;
  let loop = Promise.resolve();
  if (sharp) {
    rmSync(framesDir, { recursive: true, force: true });
    mkdirSync(framesDir, { recursive: true });
    cdp = true;
    // screenshots one after another, at the full pixel size (a screencast would give the layout size only): about 10 to 20 a second, each kept with the moment it was asked for
    capturing = true;
    loop = (async () => {
      while (capturing) {
        const at = Date.now() / 1000;
        const shot = await page.screenshot({ type: "jpeg", quality: 90, animations: "allow", caret: "initial", scale: "device", timeout: 3000 }).catch(() => null);
        if (!shot) {
          missed += 1;
          continue;
        }
        const name = `${String(frames.length).padStart(5, "0")}.jpg`;
        writeFileSync(path.join(framesDir, name), shot);
        frames.push({ name, at });
      }
    })();
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(URL_VIDEO, { waitUntil: "networkidle", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  const mouse = { x: run.viewport.width * 0.62, y: run.viewport.height * 0.7 };
  await page.mouse.move(mouse.x, mouse.y);
  const rows = [];
  for (const scene of SCENES) {
    await page.waitForSelector(scene.wait, { timeout: 20_000 });
    const start = (Date.now() - t0) / 1000;
    if (scene.until) for (let i = 0; i < 100 && !(await scene.until(page)); i++) await page.waitForTimeout(60);
    if (scene.then) await page.waitForSelector(scene.then, { timeout: 15_000 });
    await page.waitForTimeout(scene.hold);
    if (scene.click) await pressAt(page, scene.click, mouse);
    else if (scene.key) await page.keyboard.press("ArrowRight");
    rows.push({ scene: scene.id, start: Math.round(start * 10) / 10, end: 0, voiceOver: scene.vo });
  }
  // a scene lasts until the next one is on screen (the answers in between belong to the scene that asked)
  const end = (Date.now() - t0) / 1000;
  rows.forEach((r, i) => (r.end = i + 1 < rows.length ? rows[i + 1].start : Math.round(end * 10) / 10));
  await page.waitForTimeout(800);
  if (cdp) {
    capturing = false;
    await loop;
    // ffconcat: each picture shown until the next one, so the timing is the real one
    const lines = ["ffconcat version 1.0"];
    frames.forEach((f, i) => lines.push(`file '${f.name}'`, `duration ${((frames[i + 1]?.at ?? f.at + 0.8) - f.at).toFixed(3)}`));
    if (frames.length) lines.push(`file '${frames[frames.length - 1].name}'`);
    writeFileSync(path.join(framesDir, "frames.ffconcat"), lines.join("\n") + "\n");
  }
  const video = sharp ? null : page.video();
  await context.close();
  const rowsOut = { size: run.label, layoutWidth: run.viewport.width, storyStarts: rows[0].start, storyEnds: Math.round(end * 10) / 10, scenes: rows, pageErrors: errors };
  if (sharp) {
    // times from the first picture (t = 0 of frames.ffconcat)
    const zero = frames.length ? frames[0].at - t0 / 1000 : 0;
    const shift = (x) => Math.round((x - zero) * 10) / 10;
    Object.assign(rowsOut, { storyStarts: shift(rowsOut.storyStarts), storyEnds: shift(rowsOut.storyEnds), scenes: rows.map((r) => ({ ...r, start: shift(r.start), end: shift(r.end) })) });
    const timings = { frames: path.basename(framesDir), count: frames.length, perSecond: frames.length > 1 ? Math.round((frames.length - 1) / (frames[frames.length - 1].at - frames[0].at)) : null, missed, list: "frames.ffconcat", firstFrameAt: frames.length ? Math.round((frames[0].at * 1000 - t0) / 100) / 10 : null, ...rowsOut };
    writeFileSync(path.join(framesDir, "timings.json"), JSON.stringify(timings, null, 1) + "\n");
    return timings;
  }
  const dest = path.join(OUT, `demo-video-${run.label}.webm`);
  copyFileSync(await video.path(), dest); // another disk: no rename
  const timings = { video: path.basename(dest), ...rowsOut };
  writeFileSync(path.join(OUT, `timings-${run.label}.json`), JSON.stringify(timings, null, 1) + "\n");
  return timings;
}

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await connect(port)) throw new Error(`port ${port} is already in use (it is not killed: free it or wait)`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "dv-record-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL, DEMO_VIDEO: "on" };
  if (!process.argv.includes("--no-build")) {
    console.log("demo-video-record: building the web app against the stand-in");
    rmSync(path.join(WEB_DIR, ".next"), { recursive: true, force: true });
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes });
  const nextBin = path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next");
  const web = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "fake-clock.cjs")}`, VISUAL_FIXED_NOW: String(FIXED_NOW) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  web.stdout.on("data", (d) => (log += d));
  web.stderr.on("data", (d) => (log += d));
  const stop = async () => {
    try {
      web.kill("SIGTERM");
    } catch {
      // gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  };
  process.on("SIGINT", () => stop().then(() => process.exit(130)));
  let failed = false;
  try {
    await waitForPort(WEB_PORT);
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const cookie = sessionCookieValue();
    // one page load first, so the recordings never show the server's first, slower answer
    {
      const warm = await browser.newContext({ ignoreHTTPSErrors: true });
      await warm.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
      await (await warm.newPage()).goto(URL_VIDEO, { waitUntil: "networkidle", timeout: 60_000 });
      await warm.close();
    }
    const all = [];
    for (const run of RUNS) {
      const timings = await record(browser, run, cookie, tmp, false);
      all.push(timings);
      console.log(`${timings.pageErrors.length ? "CHECK" : "ok   "} ${timings.video}: the story runs ${timings.storyStarts}s to ${timings.storyEnds}s (${Math.round((timings.storyEnds - timings.storyStarts) * 10) / 10}s)${timings.pageErrors.length ? `; page errors: ${timings.pageErrors.join(" | ")}` : ""}`);
      if (timings.pageErrors.length) failed = true;
      if (FRAMES) {
        const f = await record(browser, run, cookie, tmp, true);
        console.log(`${f.pageErrors.length || f.count < 300 ? "CHECK" : "ok   "} ${f.frames}/: ${f.count} pictures, about ${f.perSecond} a second (${f.missed} missed); the story runs ${f.storyStarts}s to ${f.storyEnds}s`);
        if (f.pageErrors.length || f.count < 300) failed = true;
      }
    }
    await browser.close();
    const md = [
      "# Demo video: the recorded scenes",
      "",
      "Made by `e2e/visual/demo-video-record.mjs` (the real web app, invented data, nothing sent). Times are seconds from the start of each file; cut the video to the story (the first scene's start to the last scene's end).",
      "",
      `| Scene | ${all.map((t) => `${t.size} (${t.video})`).join(" | ")} | Voice-over |`,
      `|---|${all.map(() => "---|").join("")}---|`,
      ...SCENES.map((s) => `| ${s.id} | ${all.map((t) => { const r = t.scenes.find((x) => x.scene === s.id); return r ? `${r.start}-${r.end}` : "-"; }).join(" | ")} | ${s.vo} |`),
      "",
    ].join("\n");
    writeFileSync(path.join(OUT, "scenes.md"), md);
    copyFileSync(fileURLToPath(import.meta.url), path.join(OUT, "demo-video-record.mjs"));
    const sent = standIn.hits.filter((h) => !h.startsWith("GET "));
    console.log(sent.length ? `\ndemo-video-record: CHECK the stand-in was asked to change something:\n  ${sent.join("\n  ")}` : "\ndemo-video-record: nothing but reads reached the stand-in (no POST/PUT/DELETE)");
    if (sent.length) failed = true;
    console.log(`demo-video-record: ${readdirSync(OUT).filter((f) => f.endsWith(".webm")).join(", ")} in ${OUT}`);
  } catch (e) {
    failed = true;
    console.error(`demo-video-record: ${e.message}\n--- web log (tail) ---\n${log.slice(-1500)}`);
  } finally {
    await stop();
  }
  process.exit(failed ? 1 : 0);
}

main();
