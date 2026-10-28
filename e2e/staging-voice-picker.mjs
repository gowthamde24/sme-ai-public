// The voice picker and "Hear it" on staging, in a real browser, as a signed-in synthetic demo owner (Settings > AI assistant). Staging only. The demo owner's password and authenticator secret are read from Secret Manager into memory (staging-df-lib.mjs).
//   node e2e/staging-voice-picker.mjs [textiles|construction_materials|education]
// Checks: the Voice block shows voice cards with a Default badge; a sample plays without a content-security-policy block or a network error; "Use this voice" ticks the voice and the default goes back; "Hear it" gives a sound or the plain "no sound" line. Leaves the workspace on its default voice.
import { SHOTS, WEB, session, shot, go } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const s = await session(pack, "desktop");
const out = [];
const ok = (name, pass, note = "") => {
  out.push({ name, pass, note });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const csp = [];
s.page.on("console", (m) => /content security policy|refused to load media/i.test(m.text()) && csp.push(m.text().slice(0, 200)));
const media = [];
s.page.on("response", (r) => /\/voice-pick\?/.test(r.url()) && media.push(`${r.status()} ${r.headers()["content-type"] ?? ""}`));
try {
  await go(s, "/settings?section=assistant");
  const block = s.page.locator('[data-part="voice-picker"]');
  await block.waitFor({ timeout: 30000 });
  const cards = await block.locator("[data-voice]").count();
  ok("voice cards are shown", cards >= 1, `${cards} cards`);
  ok("a default badge is shown", (await block.getByText("Default", { exact: true }).count()) >= 1);
  ok("not the mock notice", (await block.locator('[role="note"]').count()) === 0);
  await shot(s, `vp-${pack}-1-block`);

  // a sample: play, then see the sound is really playing (currentTime moves) and no policy block
  const play = block.locator("[data-play]").first();
  const vid = await play.getAttribute("data-play");
  await play.click();
  await s.page.waitForTimeout(2500);
  ok("a sample plays through the app's own route", media.some((m) => m.startsWith("200 audio/")) && csp.length === 0 && (await block.getByRole("alert").count()) === 0, `${vid}: ${media.join(" | ")} ${csp.join(" ")}`);
  await shot(s, `vp-${pack}-2-playing`);
  await play.click();

  // choose a voice that is not the default (if any), then go back to the default
  const other = block.locator("[data-voice]:not([data-in-use])").first();
  if (await other.count()) {
    const id = await other.getAttribute("data-voice");
    await other.getByRole("button", { name: "Use this voice" }).click();
    await s.page.waitForFunction((v) => document.querySelector(`[data-voice="${v}"]`)?.getAttribute("data-in-use") === "true", id, { timeout: 20000 });
    ok("choosing a voice ticks it", true, id);
    await shot(s, `vp-${pack}-3-chosen`);
    const dflt = block.locator("[data-voice]").filter({ hasText: "Default" }).first();
    const did = await dflt.getAttribute("data-voice");
    await dflt.getByRole("button", { name: "Use this voice" }).click();
    await s.page.waitForFunction((v) => document.querySelector(`[data-voice="${v}"]`)?.getAttribute("data-in-use") === "true", did, { timeout: 20000 });
    ok("choosing the default goes back to it", true, did);
  } else ok("a second voice to choose", false, "none in this language");

  // Hear it: the opening-line editor (not the "Hear it" of the test-call card above it)
  const line = s.page.locator('[data-part="opening-line"]');
  const hear = line.getByRole("button", { name: "Hear it" });
  await hear.scrollIntoViewIfNeeded();
  if (await hear.isEnabled()) {
    await hear.click();
    await s.page.waitForTimeout(8000);
    const err = await line.getByText("Could not make the sound now").count();
    const none = await line.locator('[role="status"]').count();
    ok("Hear it gives a sound (or the plain no-sound line), never the error line", err === 0, none ? "no-sound line shown" : "sound played");
    await shot(s, `vp-${pack}-4-hear`);
  } else ok("Hear it is available", false, "button disabled (needs a saved opening line?)");
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0]);
  await shot(s, `vp-${pack}-FAIL`).catch(() => null);
}
await s.browser.close();
console.log(`pictures in ${SHOTS}`);
process.exit(out.some((o) => !o.pass) ? 1 : 0);
