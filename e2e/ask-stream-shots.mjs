// Job DH: does the Ask box show the answer AS IT STREAMS, with a visible "thinking" state first? A real browser, the real production web app (its own /ask route, its own reader) and a stand-in API that streams a SLOW answer
// (an invented one: the first words only after 1.5 s, then a piece every 1.2 s). The browser samples the box every 150 ms; the run FAILS if the text did not grow in steps while the box said it was still working, or if the
// thinking line was never seen, or if the whole answer arrived in one go. Pictures: thinking, half way, finished; 1280 and 390 px, light and dark; English and Telugu (a Telugu letter is cut between two pieces on purpose).
//   node e2e/ask-stream-shots.mjs [--no-build] [--out DIR]      (DIR defaults to ~/Desktop/v2-overnight/shots-dh/ask)
// Port 3016 (web) and 54999 (the stand-in), like e2e/cl-shots.mjs and e2e/db-shots.mjs: never run them at once; it stops only its own two processes.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_NOW, SESSION_USER, TENANT } from "./visual/fixtures.mjs";
import { startStandIn } from "./visual/stand-in.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, "..", "apps", "web");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(WEB_DIR, "node_modules", "playwright-core"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", path.join(os.homedir(), "Desktop", "v2-overnight", "shots-dh", "ask"));
const STAND_IN_PORT = 54999;
const WEB_PORT = 3016;
const STAND_IN_URL = `https://127.0.0.1:${STAND_IN_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = { desktop: { width: 1280, height: 900, scale: 1 }, phone: { width: 390, height: 844, scale: 2 } };

const b64url = (x) => Buffer.from(x).toString("base64url");
const jwt = (payload) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("shots-signature")}`;
function sessionCookieValue() {
  const access = jwt({ sub: SESSION_USER.id, aud: "authenticated", role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }], session_id: "44444444-4444-4444-8444-444444444444", exp: 4102444800, iat: 1790000000 });
  return `base64-${b64url(JSON.stringify({ access_token: access, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "shots-refresh", user: SESSION_USER }))}`;
}
const portBusy = (port) => new Promise((resolve) => {
  const s = net.connect(port, "127.0.0.1", () => (s.destroy(), resolve(true)));
  s.on("error", () => resolve(false));
});
async function waitForPort(port, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portBusy(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nothing listening on ${port}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The invented answers, as the API sends them: SSE, one event per piece. The Telugu one is cut in the middle of a letter (two UTF-8 bytes of "ఆ" are in different network chunks). */
const ANSWERS = {
  en: { pieces: ["Two leads ", "need you today: ", "Meena Sarees and ", "Anita Textiles."], first: 1500, every: 1200 },
  te: { pieces: ["ఈ రోజు ", "రెండు లీడ్‌లు ", "మీ కోసం ", "ఎదురు చూస్తున్నాయి."], first: 1500, every: 1200 },
};
const sse = (name, data) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;
const ASK_ROUTE = [
  "POST",
  /^\/v1\/tenants\/[0-9a-f-]{36}\/assistant\/messages$/,
  async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const lang = /[ఀ-౿]/.test(raw) ? "te" : "en";
    const { pieces, first, every } = ANSWERS[lang];
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
    await sleep(first);
    for (const piece of pieces) {
      const bytes = Buffer.from(sse("text", { delta: piece }));
      if (lang === "te" && piece.startsWith("రెండు")) {
        const cut = Math.floor(bytes.length / 2) + 1; // somewhere inside the event, possibly inside a letter
        res.write(bytes.subarray(0, cut));
        await sleep(120);
        res.write(bytes.subarray(cut));
      } else res.write(bytes);
      await sleep(every);
    }
    res.write(sse("done", { conversation_id: "77777777-7777-4777-8777-777777777777", message_id: "88888888-8888-4888-8888-888888888888", language: lang, kind: "answer" }));
    res.end();
  },
];

/** The Main agent is up for this run: the stand-in's own agent list says "not available" (the Ask box would be off). Everything else of the list stays as the stand-in has it. */
const AGENTS_ROUTE = [
  "GET",
  /^\/v1\/tenants\/[0-9a-f-]{36}\/agents\/status$/,
  async (req, res) => {
    const real = await import("./visual/fixtures.mjs");
    const route = real.API_ROUTES.find(([p]) => p.test(`/v1/tenants/${real.TENANT}/agents/status`));
    const list = typeof route[1] === "function" ? route[1]({ url: new URL("https://x/"), match: [] }) : route[1];
    const body = JSON.stringify((Array.isArray(list) ? list : list.items ?? list).map((a) => (a.agent === "main" ? { ...a, state: "idle", job: "Answers questions about the business." } : a)));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(Array.isArray(list) ? body : JSON.stringify({ ...list, items: JSON.parse(body) }));
  },
];

async function main() {
  for (const port of [STAND_IN_PORT, WEB_PORT]) if (await portBusy(port)) throw new Error(`port ${port} is already in use (nothing is killed: free it or wait)`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ask-stream-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const webEnv = { NEXT_PUBLIC_SUPABASE_URL: STAND_IN_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "perf-anon", NEXT_PUBLIC_API_BASE_URL: STAND_IN_URL };
  if (!process.argv.includes("--no-build")) {
    console.log("ask-stream: building the web app (a minute or two)");
    execFileSync("npm", ["run", "build"], { cwd: WEB_DIR, env: { ...process.env, ...webEnv }, stdio: ["ignore", "ignore", "inherit"] });
  } else if (!existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"))) throw new Error("--no-build, but there is no build");
  const standIn = await startStandIn({ port: STAND_IN_PORT, certPath: path.join(tmp, "c.pem"), keyPath: path.join(tmp, "k.pem"), extraRoutes: [ASK_ROUTE, AGENTS_ROUTE] });
  const web = spawn(process.execPath, [path.join(WEB_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB_DIR,
    env: { ...process.env, ...webEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NODE_EXTRA_CA_CERTS: path.join(tmp, "c.pem"), NODE_OPTIONS: `--require ${path.join(HERE, "visual", "fake-clock.cjs")}`, VISUAL_FIXED_NOW: FIXED_NOW },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let webLog = "";
  web.stdout.on("data", (d) => (webLog += d));
  web.stderr.on("data", (d) => (webLog += d));
  const stop = async () => {
    try {
      web.kill("SIGTERM"); // our own child, by its own process id
    } catch {
      // already gone
    }
    await standIn.close().catch(() => null);
    rmSync(tmp, { recursive: true, force: true });
  };
  const written = [];
  const problems = [];
  const timelines = {};
  let browser = null;
  try {
    await waitForPort(WEB_PORT);
    browser = await chromium.launch();
    const cookie = sessionCookieValue();
    for (const scheme of ["light", "dark"]) {
      for (const [sizeName, size] of Object.entries(SIZES)) {
        for (const lang of ["en", "te"]) {
          const tag = `${lang}-${scheme}-${sizeName}`;
          if (lang === "te" && scheme === "dark") continue; // Telugu in the light theme only: the cut letter is what matters
          const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", isMobile: sizeName === "phone", hasTouch: sizeName === "phone" });
          await context.addCookies([{ name: "sme_consent", value: "1.a0", url: WEB_URL }, { name: "sme_lang", value: lang, url: WEB_URL }, { name: "sb-127-auth-token", value: cookie, url: WEB_URL }]);
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
          page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
          await page.goto(`${WEB_URL}/app/tenants/${TENANT}`, { waitUntil: "networkidle" });
          const live = page.locator('[data-ask="live"]');
          await live.waitFor({ timeout: 30_000 });
          const question = lang === "te" ? "ఈ రోజు నేను ఏం చూడాలి?" : "Who needs me today?";
          await live.locator("input").first().fill(question);
          const t0 = Date.now();
          await live.locator('button[type="submit"]').first().click();
          // sample every 150 ms: the answer paragraph (class whitespace-pre-wrap), the thinking line (the muted paragraph after the "You asked" line) and whether the region says it is busy
          const samples = [];
          for (let i = 0; i < 120; i++) {
            await sleep(150);
            const s = await page.evaluate(() => {
              const r = [...document.querySelectorAll('div[aria-live="polite"]')].filter((d) => d.querySelector("p")).pop();
              if (!r) return null;
              const answer = r.querySelector(":scope > p.whitespace-pre-wrap");
              const ps = [...r.querySelectorAll(":scope > p")];
              const thinking = !answer && ps.length >= 2 && ps[1].className.includes("text-muted");
              // is the newest text inside what a person can see? above the fixed foot (the question bar and the tab bar on a phone), and not above the header
              const box = (answer ?? ps[1] ?? r).getBoundingClientRect();
              const foot = window.innerWidth < 768 ? 168 : 24;
              const inView = box.bottom <= window.innerHeight - foot + 2 && box.top >= 0;
              return { busy: r.getAttribute("aria-busy") === "true", answer: answer?.textContent ?? "", thinking, thinkingText: thinking ? ps[1].textContent : "", inView };
            });
            if (!s) continue;
            samples.push({ t: Date.now() - t0, busy: s.busy, text: s.answer, thinking: s.thinking, thinkingText: s.thinkingText, inView: s.inView });
            if (!s.busy && s.answer === ANSWERS[lang].pieces.join("")) break;
          }
          // the timeline: the distinct answers seen while busy, and when each first appeared
          const seen = [];
          for (const s of samples) if (s.busy && s.text && (seen.length === 0 || seen.at(-1).text !== s.text)) seen.push({ t: s.t, text: s.text });
          const first = seen[0]?.t ?? null;
          const last = samples.at(-1);
          const full = ANSWERS[lang].pieces.join("");
          const thinkingSeen = samples.some((s) => s.busy && s.thinking && !s.text);
          timelines[tag] = { thinkingMs: samples.find((s) => s.busy && s.thinking && !s.text)?.t ?? null, thinkingText: samples.find((s) => s.thinking)?.thinkingText ?? null, firstWordAt: first, steps: seen.length, final: last?.text, busyAtEnd: last?.busy };
          const check = (ok, what) => {
            if (!ok) problems.push(`${tag}: ${what}`);
          };
          check(thinkingSeen, "the thinking line was never seen before the first words");
          check(first !== null && first >= 1000, `the first words appeared at ${first} ms: the stand-in holds them back 1500 ms, so something painted words that were not sent`);
          check(seen.length >= 3, `the answer grew in only ${seen.length} step(s): it did not stream`);
          check(last && last.text === full && !last.busy, `the box did not end whole and idle (text "${last?.text}", busy ${last?.busy})`);
          check(seen.length >= 2 && seen.at(-1).t - seen[0].t >= 2400, `the first and last pieces were ${seen.length >= 2 ? seen.at(-1).t - seen[0].t : 0} ms apart: they arrived together`);
          // the page follows the answer: just before each next piece (and at the end) the newest words must be in view, above the fixed foot
          const lastOfEachStep = seen.map((st, i) => {
            const until = seen[i + 1]?.t ?? Infinity;
            return [...samples].reverse().find((x) => x.text === st.text && x.t < until);
          });
          const hidden = lastOfEachStep.filter((x) => x && !x.inView).length;
          check(hidden === 0, `the newest words were out of view at ${hidden} of ${lastOfEachStep.length} steps (the page did not follow the answer)`);
          timelines[tag].inViewAtEachStep = `${lastOfEachStep.length - hidden}/${lastOfEachStep.length}`;
          check(errors.length === 0, `console errors: ${errors.join(" | ")}`);
          const file = (n) => path.join(OUT, `ask-${n}-${tag}.png`);
          // replay the same question for the three pictures (a second run, at fixed moments): thinking at 0.8 s, half way at the second piece, finished at the end
          await page.reload({ waitUntil: "networkidle" });
          await live.locator("input").first().fill(question);
          await live.locator('button[type="submit"]').first().click();
          await sleep(700);
          await page.screenshot({ path: file("1-thinking") });
          written.push(`ask-1-thinking-${tag}.png  (the question is asked, no words yet: the thinking line)`);
          await sleep(1500 + 1200 + 600 - 700);
          await page.screenshot({ path: file("2-halfway") });
          written.push(`ask-2-halfway-${tag}.png  (two pieces of four are on screen, the box is still working)`);
          await sleep(1200 * 3 + 900);
          await page.screenshot({ path: file("3-done") });
          written.push(`ask-3-done-${tag}.png  (the whole answer)`);
          await context.close();
        }
      }
    }
  } catch (error) {
    problems.push(error.message);
    console.error(`ask-stream: ${error.message}\n--- web log (tail) ---\n${webLog.slice(-1500)}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => null);
    await stop();
  }
  writeFileSync(path.join(OUT, "timelines.json"), JSON.stringify(timelines, null, 1));
  writeFileSync(path.join(OUT, "README.txt"), `${written.join("\n")}\n\nTIMELINES (ms from the click): thinkingMs = first sample with the thinking line, firstWordAt = first words, steps = distinct answers seen while busy\n${JSON.stringify(timelines, null, 1)}\n${problems.length ? `\nPROBLEMS:\n${problems.join("\n")}\n` : ""}`);
  console.log(`${written.length} pictures in ${OUT}\n${Object.entries(timelines).map(([k, v]) => `${k}: thinking at ${v.thinkingMs} ms, first words at ${v.firstWordAt} ms, ${v.steps} steps, in view at ${v.inViewAtEachStep}, ends "${(v.final ?? "").slice(0, 40)}" busy=${v.busyAtEnd}`).join("\n")}${problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nno problems"}`);
  if (problems.length) process.exitCode = 1;
}

main();
