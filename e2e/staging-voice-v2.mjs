// Voice system v2, acceptance A1-A5 in a REAL browser on staging (job-voice-system-v2.md): a fake microphone plays a recorded question into the chat, every frame of the voice socket is captured, and
// the audio of each turn is turned into text by Sarvam (key from Secret Manager into memory, never printed or written). Synthetic demo owner; staging only; made-up data.
//   node e2e/staging-voice-v2.mjs [textiles|construction_materials|education] [A1|A2|A3|A4|A5|all]
// A1 Telugu (native + romanised): every audio chunk of the turn has the te voice the workspace chose, ONE voice id per turn, the speech is Telugu text. A2 the same for English, Hindi, Kannada.
// A3 Male: the same with the male voices. A4 filler + answer of a turn: identical voice id. A5 changing the te voice in Settings: the next Telugu turn uses it; "Hear it" answers.
// The captured audio of the Telugu and English turns is saved as m4a in ~/Desktop/stack19-jobs/voice-v2-check/ for the planner to listen to.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { session, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const only = process.argv[3] || "all";
const OUT = path.join(os.homedir(), "Desktop/stack19-jobs/voice-v2-check");
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(path.join(os.tmpdir(), "vv2-"));
const sarvamKey = execFileSync("gcloud", ["secrets", "versions", "access", "latest", "--secret=sme-sarvam-api-key", "--project=project-2757c07e-37d2-4167-88f"], { encoding: "utf8" }).trim();

const rows = [];
const check = (id, name, pass, note = "") => {
  rows.push({ id, name, pass, note });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name} ${note}`);
};

// ---- the recorded questions (macOS `say`), 14 s of silence in front so the question comes after the greeting
const QUESTIONS = {
  te: { say: ["-v", "Geeta"], text: "ఈ రోజు కొత్త లీడ్స్ ఏమైనా వచ్చాయా?", script: /[ఀ-౿]/g },
  te_rom: { say: ["-v", "Geeta"], text: "Eeroju edaina kotha leads vachaaya?", script: /[ఀ-౿]/g, lang: "te" },
  en: { say: [], text: "Did any new leads come in today?", script: /[A-Za-z]/g },
  hi: { say: ["-v", "Lekha"], text: "आज कोई नया लीड आया क्या?", script: /[ऀ-ॿ]/g },
  kn: { say: ["-v", "Soumya"], text: "ಇಂದು ಯಾವುದಾದರೂ ಹೊಸ ಲೀಡ್ ಬಂದಿದೆಯೇ?", script: /[ಀ-೿]/g },
};
function wavFor(key) {
  const q = QUESTIONS[key];
  const aiff = path.join(tmp, `${key}.aiff`), raw = path.join(tmp, `${key}-raw.wav`), wav = path.join(tmp, `${key}.wav`);
  execFileSync("say", [...q.say, "-o", aiff, q.text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, raw]);
  const buf = readFileSync(raw);
  const at = buf.indexOf("data");
  const pcm = buf.subarray(at + 8, at + 8 + buf.readUInt32LE(at + 4));
  writeFileSync(wav, Buffer.concat([wavHeader(16000 * 2 * 14 + pcm.length, 16000), Buffer.alloc(16000 * 2 * 14), pcm]));
  return wav;
}
function wavHeader(len, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + len, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(len, 40);
  return h;
}

// ---- Sarvam speech-to-text of the captured audio (PCM16, 24 kHz)
async function stt(pcm, language = "unknown") {
  const form = new FormData();
  form.append("file", new Blob([Buffer.concat([wavHeader(pcm.length, 24000), pcm])], { type: "audio/wav" }), "turn.wav");
  form.append("model", "saarika:v2.5");
  form.append("language_code", language);
  const r = await fetch("https://api.sarvam.ai/speech-to-text", { method: "POST", headers: { "api-subscription-key": sarvamKey }, body: form });
  if (!r.ok) return { transcript: "", language: `http ${r.status}` };
  const j = await r.json();
  return { transcript: String(j.transcript ?? ""), language: String(j.language_code ?? "") };
}

/** Plays one recorded question into a fresh browser's chat and returns what the socket sent, grouped by turn. */
async function ask(key, { tag }) {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wavFor(key)}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
  const s = await session(pack, "desktop", { browser });
  const p = s.page;
  const turns = new Map(); // turn -> { voices: [ {voice_id, language, name} ], bytes: [Buffer], ended: [ {voice_id, language} ] }
  const captions = [];
  let current = null;
  const turnOf = (n) => turns.get(n) ?? turns.set(n, { voices: [], bytes: [], ended: [] }).get(n);
  let seenVoiceMessage = false;
  p.on("websocket", (ws) => {
    if (!/voice-chat/.test(ws.url())) return;
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") {
        let m;
        try { m = JSON.parse(payload); } catch { return; }
        if (process.env.VV2_TRACE) console.log("  <-", Date.now() % 100000, payload.slice(0, 140));
        if (m.type === "voice") { seenVoiceMessage = true; current = typeof m.turn === "number" ? m.turn : (current ?? 0); turnOf(current).voices.push({ voice_id: m.voice_id, language: m.language, name: m.name }); }
        else if (m.type === "audio_end") turnOf(current ?? 0).ended.push({ voice_id: m.voice_id, language: m.language });
        else if (m.type === "caption") captions.push({ who: m.who, text: m.text });
      } else if (current !== null) turnOf(current).bytes.push(Buffer.from(payload));
      else turnOf(-1).bytes.push(Buffer.from(payload)); // a sound before any `voice` message: it has no voice id (a failure of the contract)
    });
  });
  try {
    await s.context.grantPermissions(["microphone"], { origin: "https://staging.stack19.com" });
    await p.goto(`${s.base}/outbox`, { waitUntil: "domcontentloaded" });
    const orb = p.locator('[data-ask="orb"]');
    await orb.waitFor({ timeout: 45000 });
    await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    await sleep(1500);
    await orb.click();
    await p.locator('[data-chat="mic"]').click();
    const t0 = Date.now();
    let user = false;
    while (Date.now() - t0 < 120000) {
      user = user || (await p.locator('[data-chat="you"], [data-chat="you-live"]').count()) > 0;
      const answered = [...turns.keys()].some((n) => n >= 1 && turns.get(n).ended.length > 0);
      if (user && answered) break;
      await sleep(500);
    }
    await sleep(3000);
    await p.locator('[data-chat="mic"]').click().catch(() => null);
  } finally {
    await browser.close();
  }
  console.log(`${tag}/${key} frames:`, JSON.stringify([...turns.entries()].map(([n, t]) => ({ turn: n, voices: t.voices.map((v) => v.voice_id), binaryBytes: t.bytes.reduce((a, b) => a + b.length, 0), ended: t.ended.length }))), "captions:", JSON.stringify(captions.map((c) => `${c.who}: ${c.text.slice(0, 60)}`)));
  return { turns, captions, seenVoiceMessage, tag };
}

function save(name, pcm) {
  const wav = path.join(OUT, `${name}.wav`);
  writeFileSync(wav, Buffer.concat([wavHeader(pcm.length, 24000), pcm]));
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", wav, path.join(OUT, `${name}.m4a`)]);
  execFileSync("rm", [wav]);
}

/** Reads the voices in force from Settings > AI assistant > Voice: { te: "te-ramya", ... } and the gender. */
async function inForce(s) {
  await s.page.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  await s.page.locator('[data-part="voice-picker"]').waitFor({ timeout: 45000 });
  return s.page.evaluate(() => ({
    gender: document.querySelector('[data-part="voice-gender"] [aria-checked="true"]')?.getAttribute("data-gender"),
    voices: Object.fromEntries([...document.querySelectorAll("[data-voice-select]")].map((sel) => [sel.getAttribute("data-voice-select"), sel.value])),
  }));
}

async function judge(id, key, expected, { save: name } = {}) {
  const lang = QUESTIONS[key].lang ?? key;
  const run = await ask(key, { tag: id });
  const answerTurns = [...run.turns.entries()].filter(([n]) => n >= 1);
  const all = [...run.turns.values()];
  check(id, `${key}: the socket announces the voice of every turn (a \`voice\` message before the sound)`, run.seenVoiceMessage && !run.turns.has(-1), run.seenVoiceMessage ? "" : "no voice message");
  const unique = (n) => new Set(run.turns.get(n).voices.map((v) => v.voice_id));
  check(id, `${key}: ONE voice id per turn (filler and answer identical)`, answerTurns.length > 0 && answerTurns.every(([n]) => unique(n).size === 1), answerTurns.map(([n]) => `turn ${n}: ${[...unique(n)].join("+")}`).join("; "));
  const want = expected[lang];
  check(id, `${key}: the voice is the one the workspace chose for ${lang} (${want})`, answerTurns.length > 0 && answerTurns.every(([n]) => [...unique(n)].every((v) => v === want)), "");
  check(id, `${key}: the voice message names the language ${lang}`, answerTurns.every(([n]) => run.turns.get(n).voices.every((v) => v.language === lang)), answerTurns.map(([n]) => run.turns.get(n).voices.map((v) => v.language).join(",")).join(" "));
  check(id, `${key}: audio_end carries the same voice id`, answerTurns.every(([n]) => run.turns.get(n).ended.every((e) => e.voice_id === [...unique(n)][0])), "");
  const pcm = Buffer.concat(answerTurns.flatMap(([n]) => run.turns.get(n).bytes));
  if (pcm.length < 2000) return check(id, `${key}: audio captured`, false, `${pcm.length} bytes`);
  const heard = await stt(pcm);
  const letters = (heard.transcript.match(QUESTIONS[key === "te_rom" ? "te" : key].script) ?? []).length;
  const share = letters / Math.max(1, heard.transcript.replace(/[\s\d.,!?'"-]/g, "").length);
  console.log(`${id} ${key}: STT (${heard.language}): ${JSON.stringify(heard.transcript.slice(0, 160))}`);
  check(id, `${key}: Sarvam STT of the captured audio is ${lang} (${Math.round(share * 100)}% in the script)`, share >= (lang === "en" ? 0.9 : 0.6), "");
  if (name) save(name, pcm);
  return run;
}

try {
  const s0 = await session(pack, "desktop");
  let force = await inForce(s0);
  console.log("in force:", JSON.stringify(force));
  const wanted = (a) => only === "all" || only === a;
  if (wanted("A1")) { await judge("A1", "te", force.voices, { save: "te-turn" }); await judge("A1", "te_rom", force.voices); }
  if (wanted("A2")) { await judge("A2", "en", force.voices, { save: "en-turn" }); await judge("A2", "hi", force.voices); await judge("A2", "kn", force.voices); }
  if (wanted("A3")) {
    await s0.page.goto(`${s0.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
    await s0.page.locator('[data-part="voice-gender"] [data-gender="male"]').click();
    await s0.page.waitForFunction(() => document.querySelector('[data-part="voice-gender"] [data-gender="male"]')?.getAttribute("aria-checked") === "true", null, { timeout: 20000 });
    force = await inForce(s0);
    check("A3", "the switch is Male and Telugu has a male voice in force", force.gender === "male" && /./.test(force.voices.te ?? ""), JSON.stringify(force.voices));
    await judge("A3", "te", force.voices, { save: "te-male-turn" });
    await s0.page.locator('[data-part="voice-gender"] [data-gender="female"]').click();
    await s0.page.waitForFunction(() => document.querySelector('[data-part="voice-gender"] [data-gender="female"]')?.getAttribute("aria-checked") === "true", null, { timeout: 20000 });
    force = await inForce(s0);
  }
  if (wanted("A5")) {
    // another Telugu voice of the workspace's gender
    const other = await s0.page.evaluate(() => [...document.querySelector('[data-voice-select="te"]').options].map((o) => o.value).find((v) => v !== document.querySelector('[data-voice-select="te"]').value));
    check("A5", "Telugu has a second voice to choose", Boolean(other), String(other));
    if (other) {
      await s0.page.locator('[data-voice-select="te"]').selectOption(other);
      await s0.page.locator('[data-part="toast"]').waitFor({ timeout: 30000 });
      force = await inForce(s0);
      check("A5", "the new Telugu voice is in force after a reload of Settings", force.voices.te === other, force.voices.te ?? "");
      await judge("A5", "te", force.voices);
      const heard = await s0.page.evaluate(async (base) => {
        const r = await fetch(`${base}/voice-sample?voice=female_warm&lang=te&tone=warm&name=x`, { cache: "no-store" });
        return { status: r.status, type: r.headers.get("content-type"), voice: r.headers.get("x-voice-id"), bytes: (await r.arrayBuffer()).byteLength };
      }, s0.base.replace("https://staging.stack19.com", ""));
      check("A5", `"Hear it" answers with sound (X-Voice-Id: ${heard.voice ?? "not sent"})`, heard.status === 200 && /audio/.test(heard.type ?? "") && heard.bytes > 2000 && (heard.voice === null || heard.voice === other), JSON.stringify(heard));
    }
  }
  await s0.browser.close();
} catch (e) {
  check("script", "failed", false, String(e.message || e).split("\n")[0]);
}
console.log("\n| check | name | result |\n|---|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.name} | ${r.pass ? "pass" : "FAIL"} ${r.note} |`);
console.log(`m4a in ${OUT}`);
process.exit(rows.some((r) => !r.pass) ? 1 : 0);
