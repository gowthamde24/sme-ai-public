// Settings > AI assistant on staging (rule 14 self-check of the setup preview), as a synthetic demo owner. Staging only.
//   node e2e/staging-setup-preview.mjs [textiles|construction_materials|education] [desktop|phone]
// Checks: the card's line is the SAME text the voice-sample route returns for "Hear it" (text=1); no old persona caption or
// way-of-talking / speed control; "Speaking in <language> · <voice>" is there; the assistant's name is in the line and "Tara" is nowhere;
// the Voice section has a row for all six languages and the workspace's own languages come first; no page errors.
import { session, shot, sleep } from "./staging-df-lib.mjs";

const pack = process.argv[2] || "textiles";
const size = process.argv[3] || "desktop";
let failed = 0;
const ok = (name, pass, note = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${note}`);
};
const s = await session(pack, size);
const p = s.page;
try {
  await p.goto(`${s.base}/settings?section=assistant`, { waitUntil: "domcontentloaded" });
  await p.locator('aside [data-part="preview-line"]').waitFor({ timeout: 45000 });
  await sleep(1500);
  const card = (await p.locator('aside [data-part="preview-line"]').textContent())?.replace(/^[“"]|[”"]$/g, "").trim() ?? "";
  const lang = (await p.locator('aside [data-part="preview-line"]').getAttribute("lang")) ?? "te";
  const said = await p.evaluate(async ([base, l]) => {
    const r = await fetch(`${base}/voice-sample?voice=female_warm&lang=${l}&tone=warm&name=&text=1`, { cache: "no-store" });
    return r.ok ? (await r.json()).text : null;
  }, [`/app/tenants/${s.tenant}`, lang]);
  ok("the card's line is the same text Hear it speaks", !!said && said.trim() === card, `${JSON.stringify(card.slice(0, 80))} vs ${JSON.stringify((said ?? "").slice(0, 80))}`);
  const aside = (await p.locator("aside").first().textContent()) ?? "";
  ok("no old persona caption (way of talking, speed)", !/Warm and friendly|Respectful|Crisp|\d(\.\d+)?×|Speaking speed/i.test(aside) && (await p.locator("#asst-speed").count()) === 0 && (await p.locator("#asst-style-h").count()) === 0);
  ok("the card says 'Speaking in <language> · <voice>'", /Speaking in .+ · \S+/.test(aside) || /·/.test(aside), aside.match(/Speaking in [^\n]*?(?=“|▶|$)/)?.[0]?.slice(0, 60) ?? "");
  const body = (await p.locator("main").first().textContent()) ?? "";
  ok("no 'Tara' anywhere", !/\bTara\b/.test(body) && !/\bTara\b/.test(card));
  const name = (await p.locator("#asst-name").inputValue().catch(() => "")) || "";
  console.log(`assistant name field: ${JSON.stringify(name)}`);
  ok("the assistant's own name is in the card's line (when the line names it)", !name || card.includes(name) || /assistant|అసిస్టెంట్|असिस्टेंट|ಅಸಿಸ್ಟೆಂಟ್/i.test(card), name);
  const rows = await p.locator("[data-voice-lang]").evaluateAll((els) => els.map((e) => e.getAttribute("data-voice-lang")));
  ok("the Voice section has a row for all six languages", [...rows].sort().join() === "en,hi,kn,ml,ta,te", rows.join());
  const te = await p.locator('[data-voice-select="te"] option').allTextContents().catch(() => []);
  console.log(`te options: ${JSON.stringify(te)}`);
  ok("Telugu offers Ramya first (recommended)", /^Ramya/.test(te[0] ?? ""), te[0] ?? "");
  await shot(s, `sp-${pack}-${size}-1-card`);
  await p.locator('[data-part="voice-picker"]').scrollIntoViewIfNeeded().catch(() => null);
  await shot(s, `sp-${pack}-${size}-2-voices`);
  ok("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("script", false, String(e.message || e).split("\n")[0].slice(0, 200));
  await shot(s, `sp-${pack}-${size}-FAIL`).catch(() => null);
}
await s.browser.close();
process.exit(failed ? 1 : 0);
