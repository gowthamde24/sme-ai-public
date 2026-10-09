// The contact sheet of the workspace redesign (docs/plans/workspace-v2-redesign-plan.md, section 6). ON DEMAND, LOCAL ONLY, not in CI.
//
//   node e2e/screens.mjs --batch b1a-frame --out ~/Desktop/v2-overnight/shots/b1a-frame [--only orders,review] [--base http://localhost:3002]
//
// Signs in as the demo owner (the fixed local demo password and the code printed by `make demo-code`, typed like a person), visits the
// screens, and writes one PNG per screen x viewport (phone 390x844, desktop 1280x800) x theme (light, dark), English, plus index.html.
// It also lists, per picture, a horizontal overflow on the phone, a non-2xx answer, a missing frame and console errors, so a broken screen is
// named even when nobody looks. Uses the installed Google Chrome (Playwright's `channel: "chrome"`): nothing is downloaded.
// Refuses a non-local address. Writes nothing inside the repository unless --out points there. Screenshots are never committed.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const spec of ["playwright", "playwright-core", path.join(HERE, "../apps/web/node_modules/playwright-core")]) {
    try {
      return require(spec);
    } catch {
      /* try the next */
    }
  }
  throw new Error("screens: neither playwright nor playwright-core is installed (apps/web has playwright-core as a dev dependency)");
}
const { chromium } = loadPlaywright();

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", process.env.E2E_WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
const BATCH = arg("batch", "adhoc");
const OUT = path.resolve(arg("out", path.join(HERE, "shots", BATCH)));
const ONLY = arg("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PW = "Demo-Only-Local-Password-1!"; // the demo seed's fixed password (scripts/seed_demo.py): valid only against a local stack
const EMAIL = "demo-owner@demo.example.test";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname)) {
  console.error(`screens: refusing ${BASE}: this signs in with the local demo password.`);
  process.exit(2);
}

const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const SCHEMES = ["light", "dark"];

/** The code of the local demo owner, from `make demo-code` (it lasts about 30 seconds: ask just before typing). */
function demoCode() {
  const out = execFileSync("make", ["-s", "demo-code"], { cwd: path.join(HERE, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const code = out.split("\n").find((l) => /^\d{6}$/.test(l.trim()));
  if (!code) throw new Error("screens: make demo-code printed no code (is the local stack up and the demo seeded?)");
  return code.trim();
}

async function signIn(browser) {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(app|auth\/mfa)/, { timeout: 30000 });
  if (/\/auth\/mfa/.test(page.url())) {
    await page.fill('input[name="code"]', demoCode());
    await Promise.all([page.waitForURL(/\/app/, { timeout: 30000 }), page.click('button:has-text("Verify")')]);
  }
  const state = await context.storageState();
  await context.close();
  return state;
}

/** Find the demo workspace and one example of each record, through the pages themselves (no ids to configure). */
async function discover(browser, state) {
  const context = await browser.newContext({ storageState: state, viewport: VIEWPORTS.desktop });
  const page = await context.newPage();
  const href = async (url, selector) => {
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    return page.locator(selector).first().getAttribute("href", { timeout: 5000 }).catch(() => null);
  };
  await page.goto(`${BASE}/app`, { waitUntil: "load" });
  const links = await page.locator('a[href^="/app/tenants/"]').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent || "" })));
  const pick = links.find((l) => /demo/i.test(l.text)) ?? links[0];
  if (!pick) throw new Error("screens: no workspace link on /app (run `make seed-demo-manual`)");
  const tenant = pick.href.split("/")[3];
  const T = `/app/tenants/${tenant}`;
  const last = (h) => (h ? h.split("?")[0].split("/").filter(Boolean).pop() : null);
  const lead = last(await href(`${T}?tab=leads`, 'a[href*="/leads/"]'));
  const company = last(await href(`${T}?tab=companies`, 'a[href*="/companies/"]'));
  const order = last(await href(`${T}/orders`, 'a[href*="/orders/"]'));
  let enquiry = null;
  let contactConsent = null;
  if (lead) {
    enquiry = last(await href(`${T}/leads/${lead}`, 'a[href*="/enquiries/"]'));
    contactConsent = await href(`${T}/leads/${lead}`, 'a[href*="/consent"]');
  }
  let requirement = null;
  if (enquiry) {
    const q = await href(`${T}/enquiries/${enquiry}`, 'a[href*="/requirements/"]');
    requirement = q ? q.split("/")[q.split("/").indexOf("requirements") + 1] : null;
  }
  await context.close();
  return { tenant, T, lead, company, order, enquiry, requirement, contactConsent };
}

function screens(d) {
  const { T } = d;
  const all = [
    ["account", "/app"],
    ["security", "/app/security"],
    ["home", T],
    ["home-leads", `${T}?tab=leads`],
    ["review", `${T}/review`],
    ["lead", d.lead && `${T}/leads/${d.lead}`],
    ["company", d.company && `${T}/companies/${d.company}`],
    ["customers-new", `${T}/customers/new`],
    ["consent", d.contactConsent],
    ["suggestions", `${T}/suggestions`],
    ["agents", `${T}/agents`],
    ["enquiry", d.enquiry && `${T}/enquiries/${d.enquiry}`],
    ["orders", `${T}/orders`],
    ["order", d.order && `${T}/orders/${d.order}`],
    ["item-types", `${T}/item-types`],
    ["quote-policy", `${T}/quote-policy`],
    ["followups", `${T}/followups`],
    ["followup-policy", `${T}/followups/policy`],
    ["lead-followup", d.lead && `${T}/leads/${d.lead}/followup`],
    ["questions", d.requirement && `${T}/requirements/${d.requirement}/questions`],
    ["price-list", `${T}/price-list`],
    ["products-new", `${T}/products/new`],
    ["privacy", `${T}/privacy`],
    ["suppression", `${T}/suppression`],
  ];
  return all.filter(([name, url]) => url && (ONLY.length === 0 || ONLY.includes(name)));
}

/** Frame states that need a click (only with --interactions): the phone's "More" list, the workspace switcher, the account menu. */
const INTERACTIONS = (d) => [
  ["frame-more", "phone", `${d.T}/orders`, async (page) => page.getByRole("button", { name: "More" }).click()],
  ["frame-switcher", "desktop", `${d.T}/review`, async (page) => page.locator("summary", { hasText: "Switch workspace" }).click({ timeout: 3000 })],
  ["frame-switcher-phone", "phone", `${d.T}/review`, async (page) => page.locator("summary", { hasText: "Switch workspace" }).click({ timeout: 3000 })],
  ["item-types-edit", "desktop", `${d.T}/item-types`, async (page) => page.locator("summary", { hasText: /^Edit / }).first().click()],
  ["item-types-edit", "phone", `${d.T}/item-types`, async (page) => page.locator("summary", { hasText: /^Edit / }).first().click()],
  ["frame-account", "desktop", `${d.T}/review`, async (page) => page.locator("summary", { hasText: "Your account" }).click()],
];

const CHECKS = () => {
  const root = document.documentElement;
  const frame = document.querySelector('[data-frame="app"]') !== null;
  const unstyled = document.querySelector("main") === null;
  return { overflow: root.scrollWidth > root.clientWidth + 1, frame, noMain: unstyled, title: document.title, height: root.scrollHeight };
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const state = await signIn(browser);
    const d = await discover(browser, state);
    console.log(`workspace ${d.tenant}; lead ${d.lead}; company ${d.company}; order ${d.order}; enquiry ${d.enquiry}; requirement ${d.requirement}`);
    const list = screens(d);
    const rows = [];
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      for (const scheme of SCHEMES) {
        const context = await browser.newContext({ storageState: state, viewport, colorScheme: scheme, deviceScaleFactor: 1, isMobile: vpName === "phone", hasTouch: vpName === "phone" });
        await context.addCookies([
          { name: "sme_theme", value: scheme, url: BASE },
          { name: "sme_lang", value: "en", url: BASE },
        ]);
        const page = await context.newPage();
        for (const [name, url] of list) {
          const errors = [];
          const onConsole = (m) => m.type() === "error" && errors.push(m.text().slice(0, 160));
          page.on("console", onConsole);
          let status = 0;
          try {
            const res = await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 60000 });
            status = res?.status() ?? 0;
            await page.waitForTimeout(500);
            const c = await page.evaluate(CHECKS);
            const file = `${name}-${vpName}-${scheme}.png`;
            await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip: undefined });
            rows.push({ name, vpName, scheme, file, status, url, ...c, errors: [...errors], finalUrl: page.url().replace(BASE, "") });
          } catch (error) {
            rows.push({ name, vpName, scheme, file: null, status, url, error: String(error).slice(0, 200), errors });
          }
          page.off("console", onConsole);
        }
        await context.close();
      }
    }
    if (process.argv.includes("--interactions")) {
      for (const [name, vpName, url, act] of INTERACTIONS(d)) {
        for (const scheme of SCHEMES) {
          const context = await browser.newContext({ storageState: state, viewport: VIEWPORTS[vpName], colorScheme: scheme, isMobile: vpName === "phone", hasTouch: vpName === "phone" });
          await context.addCookies([{ name: "sme_theme", value: scheme, url: BASE }, { name: "sme_lang", value: "en", url: BASE }]);
          const page = await context.newPage();
          try {
            await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 60000 });
            await page.waitForTimeout(600);
            await act(page);
            await page.waitForTimeout(400);
            const file = `${name}-${vpName}-${scheme}.png`;
            await page.screenshot({ path: path.join(OUT, file), fullPage: false });
            rows.push({ name, vpName, scheme, file, status: 200, url, finalUrl: url, frame: true, errors: [] });
          } catch (error) {
            rows.push({ name, vpName, scheme, file: null, status: 0, url, error: /Switch workspace/.test(String(error)) ? "skipped: the demo owner has one workspace, so there is no switcher" : String(error).slice(0, 200), errors: [], skipped: /Switch workspace/.test(String(error)) });
          }
          await context.close();
        }
      }
    }
    writeFileSync(path.join(OUT, "index.html"), indexHtml(rows));
    writeFileSync(path.join(OUT, "report.json"), JSON.stringify(rows, null, 1));
    const problems = rows.filter((r) => !r.skipped && (r.error || r.status >= 400 || r.noMain || (r.vpName === "phone" && r.overflow) || r.finalUrl !== r.url));
    console.log(`${rows.length} pictures in ${OUT}; ${problems.length} with a problem`);
    for (const p of problems) console.log(`  ${p.name} ${p.vpName} ${p.scheme}: ${p.error ?? `status ${p.status}${p.noMain ? ", no <main>" : ""}${p.overflow ? ", horizontal overflow" : ""}${p.finalUrl !== p.url ? `, ended at ${p.finalUrl}` : ""}`}`);
  } finally {
    await browser.close();
  }
}

function indexHtml(rows) {
  const names = [...new Set(rows.map((r) => r.name))];
  const cell = (r) =>
    r?.file
      ? `<a href="${r.file}"><img src="${r.file}" loading="lazy" width="${r.vpName === "phone" ? 195 : 320}"></a><div class="n">${r.status}${r.overflow ? " overflow" : ""}${r.frame === false ? " no frame" : ""}${r.errors?.length ? ` ${r.errors.length} console error(s)` : ""}</div>`
      : `<div class="n bad">${r?.error ?? "missing"}</div>`;
  const body = names
    .map((n) => {
      const get = (vp, sc) => rows.find((r) => r.name === n && r.vpName === vp && r.scheme === sc);
      return `<tr><th>${n}</th>${[["phone", "light"], ["phone", "dark"], ["desktop", "light"], ["desktop", "dark"]].map(([vp, sc]) => `<td>${cell(get(vp, sc))}</td>`).join("")}</tr>`;
    })
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>${BATCH} contact sheet</title><style>body{font:14px system-ui;margin:1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;vertical-align:top}th{text-align:left;width:7rem}img{display:block;border:1px solid #999}.n{font-size:12px}.bad{color:#b00}</style><h1>${BATCH}</h1><p>owner, English. Columns: phone light, phone dark, desktop light, desktop dark.</p><table><tr><th></th><th>phone light</th><th>phone dark</th><th>desktop light</th><th>desktop dark</th></tr>${body}</table>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
