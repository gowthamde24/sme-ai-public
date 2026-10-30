// The chat's input box on a PHONE, on staging (owner bug 30 Oct): an auto-growing text area (1 line empty, up to about 5, then it scrolls inside, back to 1 after Send/clear), the full width of its box, the mic / live / send buttons in a row at its bottom-right, text of 16px or more, no sideways page scroll.
// Checked in Today's card and in the orb panel, at 390 and 360 px wide, with a long Telugu sentence. Synthetic demo owner. Staging only. Nothing is sent. Pictures in ~/Desktop/v2-overnight/shots-df/.
//   node e2e/staging-chat-box.mjs [textiles|construction_materials|education]
import { chromium } from "playwright";

import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const LONG = "ఈ రోజు మా దుకాణానికి వచ్చిన విచారణలు ఎన్ని ఉన్నాయి, వాటిలో ఎవరికి ముందు కాల్ చేయాలి, ఎవరికి వాట్సాప్ లో ధరల జాబితా పంపాలి, మరియు నిన్న నుండి సమాధానం ఇవ్వని వారు ఎవరు ఉన్నారో కూడా చెప్పండి. ".repeat(3);
const MID = "ఈ రోజు ఎన్ని విచారణలు వచ్చాయి, నేను ఎవరికి ముందు కాల్ చేయాలి, ఎవరికి ధరలు పంపాలి?";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};

async function measure(page, scope) {
  return scope.evaluate((root) => {
    const ta = root.querySelector("#chat-input");
    const form = root.querySelector('[data-chat="form"]');
    const r = ta.getBoundingClientRect();
    const f = form.getBoundingClientRect();
    const btns = [...form.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    return {
      h: Math.round(r.height), w: Math.round(r.width), formW: Math.round(f.width), scrollable: ta.scrollHeight > ta.clientHeight + 1,
      font: parseFloat(getComputedStyle(ta).fontSize), tag: ta.tagName,
      btnTop: Math.round(Math.min(...btns.map((b) => b.top))), taBottom: Math.round(r.bottom), btnRight: Math.round(Math.max(...btns.map((b) => b.right))), formRight: Math.round(f.right), formBottom: Math.round(f.bottom), btnBottom: Math.round(Math.max(...btns.map((b) => b.bottom))),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, vw: window.innerWidth,
    };
  });
}

async function check(label, page, scope, width) {
  const box = scope.locator("#chat-input");
  await box.scrollIntoViewIfNeeded();
  const empty = await measure(page, scope);
  ok(`${label}: the box is a text area, 16px or more`, empty.tag === "TEXTAREA" && empty.font >= 16, `${empty.tag} ${empty.font}px`);
  ok(`${label}: one line when empty`, empty.h >= 40 && empty.h <= 52, `${empty.h}px`);
  ok(`${label}: full width of its box`, empty.w >= empty.formW - 32, `box ${empty.w} of ${empty.formW}`);
  await box.fill(MID);
  const mid = await measure(page, scope);
  ok(`${label}: grows with a longer Telugu sentence`, mid.h > empty.h, `${empty.h} -> ${mid.h}px`);
  await shot({ page }, `cb-${pack}-${width}-${label}-1-mid`);
  await box.fill(LONG.slice(0, 500));
  const long = await measure(page, scope);
  ok(`${label}: stops at about five lines and scrolls inside`, long.h <= 150 && long.h >= 100 && long.scrollable, `${long.h}px, scrolls=${long.scrollable}`);
  ok(`${label}: the buttons stay under the text, at the right, inside the box`, long.btnTop >= long.taBottom - 2 && long.btnRight <= long.formRight && long.btnBottom <= long.formBottom, `buttons ${long.btnTop}..${long.btnBottom} text ends ${long.taBottom} right ${long.btnRight}/${long.formRight}`);
  ok(`${label}: no sideways scroll of the page`, !long.overflowX, `${long.vw}px`);
  await shot({ page }, `cb-${pack}-${width}-${label}-2-long`);
  await box.fill("");
  await sleep(200);
  const back = await measure(page, scope);
  ok(`${label}: back to one line when cleared`, back.h === empty.h, `${back.h}px`);
}

for (const width of [390, 360]) {
  const browser = await chromium.launch();
  const s = await session(pack, "phone", { browser });
  try {
    await s.context.addCookies([{ name: "sme_lang", value: "te", url: "https://staging.stack19.com" }]);
    await s.page.setViewportSize({ width, height: width === 390 ? 844 : 780 });
    await s.page.goto(s.base, { waitUntil: "domcontentloaded" });
    const card = s.page.locator('[data-chat="card"]');
    await card.waitFor({ timeout: 45000 });
    await sleep(1500);
    await check("card", s.page, card, width);
    // the orb panel opens over any page
    await s.page.goto(`${s.base}/outbox`, { waitUntil: "domcontentloaded" });
    const orb = s.page.locator('[data-ask="orb"]');
    await orb.waitFor({ timeout: 45000 });
    await s.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    await sleep(1500);
    await orb.click();
    const panel = s.page.locator('[data-chat="panel"]');
    await panel.waitFor({ timeout: 15000 });
    await sleep(500);
    await check("panel", s.page, panel, width);
    const pb = await panel.boundingBox();
    ok(`panel: fits the screen at ${width}px`, !!pb && pb.x >= 0 && pb.x + pb.width <= width + 1 && pb.y >= 0, JSON.stringify(pb));
  } finally {
    await browser.close();
  }
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
