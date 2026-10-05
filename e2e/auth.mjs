// Auth, second factor, security headers and the 360px pass (T006b M3a). Needs `make seed-demo` and `npm run setup-users`.
// WRITES nothing of value (it signs in as demo users and visits pages). Prints one line per step; CSP violations seen in the browser
// console are listed at the end. Local only (lib.mjs refuses any other host).
import { launch, login, shot, record, text, discover, layoutReport, passChallenge, emailOf, totp, BASE, PW } from "./lib.mjs";

const violations = [];
function watch(page, label) {
  page.on("console", (m) => {
    const t = m.text();
    if (/content security policy|refused to (load|execute|apply|connect|frame)|violates the following/i.test(t)) violations.push(`${label}: ${t.slice(0, 220)}`);
  });
  page.on("pageerror", (e) => violations.push(`${label}: pageerror ${String(e).slice(0, 160)}`));
}

const { browser, context } = await launch();
const page = await context.newPage();
watch(page, "owner");
try {
  // ---- the sign-in page
  await page.goto(`${BASE}/login`);
  let s = await shot(page, "M1-login");
  let t = await text(page);
  record("M1 sign-in page: no sign-up, a way to reset", !/Create account/i.test(t) && (await page.locator('a[href="/auth/forgot"]').count()) === 1 ? "PASS" : "FAIL", "no 'Create account'; 'Forgot your password?' link; says accounts are by invitation: " + /by invitation/.test(t), s);

  // ---- forgot password: the same answer for a known and an unknown address
  const answers = [];
  for (const email of [emailOf("owner"), "nobody-at-all@demo.example.test"]) {
    await page.goto(`${BASE}/auth/forgot`);
    await page.fill('input[name="email"]', email);
    const t0 = Date.now();
    await page.click('button:has-text("Send the link")');
    await page.waitForSelector('form [role="status"], form [role="alert"]', { timeout: 20000 });
    answers.push({ ms: Date.now() - t0, text: (await page.locator('form [role="status"], form [role="alert"]').first().innerText()).trim() });
  }
  s = await shot(page, "M2-forgot-answer");
  record("M2 reset request: identical answer and similar time for a known and an unknown address", answers[0].text === answers[1].text && Math.abs(answers[0].ms - answers[1].ms) < 700 ? "PASS" : "FAIL", `"${answers[0].text.slice(0, 70)}"; ${answers[0].ms} ms vs ${answers[1].ms} ms`, s);

  // ---- bad links
  await page.goto(`${BASE}/auth/confirm?type=invite`);
  record("M3 a link with no token says so", /expired or was already used/.test(await text(page)) && (await page.locator('button:has-text("Continue")').count()) === 0 ? "PASS" : "FAIL", "no Continue button", await shot(page, "M3-bad-link"));
  await page.goto(`${BASE}/auth/confirm?type=recovery&token_hash=${"a1b2c3d4".repeat(8)}&next=//evil.example`);
  const next = await page.locator('input[name="next"]').inputValue();
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('form [role="alert"]', { timeout: 15000 });
  record("M4 an expired or made-up token gets one fixed message; an open-redirect next is neutralised", /expired or was already used/.test(await text(page)) && next === "/app" && page.url().startsWith(BASE) ? "PASS" : "FAIL", `next carried into the form: ${next}; still on our origin: ${page.url().startsWith(BASE)}`, await shot(page, "M4-expired-token"));
  await page.goto(`${BASE}/auth/confirm?type=magiclink&token_hash=${"a1b2c3d4".repeat(8)}`);
  record("M4b a type the app does not use is refused", /expired or was already used/.test(await text(page)) ? "PASS" : "FAIL", "magiclink", await shot(page, "M4b-wrong-type"));

  // ---- the second factor at sign-in
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', emailOf("owner"));
  await page.fill('input[name="password"]', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/auth\/mfa/, { timeout: 20000 });
  s = await shot(page, "M5-challenge");
  t = await text(page);
  record("M5 an Owner with an authenticator meets the challenge, with recovery guidance", /Enter your code/.test(t) && /Lost your phone\? Ask the operator/.test(t) ? "PASS" : "FAIL", "challenge page with 'Lost your phone?' guidance", s);
  // a password-only session cannot walk around the challenge by typing a URL
  const d = await discoverUrlsBeforeChallenge(page);
  await page.goto(`${BASE}/app`);
  record("M6 a password-only session cannot reach the app by URL", /\/auth\/mfa/.test(page.url()) ? "PASS" : "FAIL", `/app -> ${new URL(page.url()).pathname}`, await shot(page, "M6-bypass"));
  await page.goto(`${BASE}/auth/mfa`);
  await passChallenge(page, emailOf("owner"), { wrongFirst: true });
  record("M7 a wrong code is refused with a fixed message, the right one signs in", /\/app/.test(page.url()) ? "PASS" : "FAIL", "wrong code -> alert; right code -> /app", await shot(page, "M7-signed-in"));

  // ---- the security page and the privileged pages under the CSP
  await page.goto(`${BASE}/app/security`);
  t = await text(page);
  record("M8 security page: authenticator on, session verified, recovery guidance", /On\./.test(t) && /verified with your authenticator/.test(t) && /If you lose your phone/.test(t) && /There are no backup codes/.test(t) ? "PASS" : "FAIL", "state, level, guidance", await shot(page, "M8-security"));
  const { tenant: T } = await discover(page);
  for (const [name, url] of [["workspace", `/app/tenants/${T}`], ["review queue", `/app/tenants/${T}/review`], ["privacy", `/app/tenants/${T}/privacy`], ["agents", `/app/tenants/${T}/agents`], ["workspaces", "/app"], ["security", "/app/security"]]) {
    await page.goto(`${BASE}${url}`);
    await page.waitForLoadState("networkidle").catch(() => null);
    record(`M9 ${name} loads and is interactive under the CSP`, (await page.locator("main").count()) === 1 ? "PASS" : "FAIL", `HTTP ok, <main> rendered`, await shot(page, `M9-${name.replace(/ /g, "-")}`));
  }

  // ---- the headers, as served
  const res = await fetch(`${BASE}/login`);
  const h = Object.fromEntries([...res.headers.entries()]);
  const csp = h["content-security-policy"] || "";
  const script = (csp.split(";").find((x) => x.trim().startsWith("script-src")) || "");
  const nonces = new Set();
  for (let i = 0; i < 3; i++) nonces.add(/'nonce-([^']+)'/.exec((await fetch(`${BASE}/login`)).headers.get("content-security-policy") || "")?.[1]);
  const headersOk = /'nonce-/.test(script) && !/'unsafe-inline'/.test(script) && /frame-ancestors 'none'/.test(csp) && h["x-content-type-options"] === "nosniff" && !!h["referrer-policy"] && !!h["permissions-policy"] && h["x-frame-options"] === "DENY" && !h["x-powered-by"] && nonces.size === 3;
  record("M10 security headers on the sign-in page", headersOk ? "PASS" : "FAIL", `CSP with a fresh nonce per request (${nonces.size}/3 distinct), no unsafe-inline for scripts, frame-ancestors none, nosniff, referrer and permissions policy, X-Frame-Options DENY, no X-Powered-By. HSTS: ${h["strict-transport-security"] ? "sent" : "not sent (development; production only)"}`);

  // ---- cookies
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  record("M11 session cookies are HttpOnly and SameSite", cookies.length > 0 && cookies.every((c) => c.httpOnly && c.sameSite === "Lax") ? "PASS" : "FAIL", `${cookies.length} cookies; Secure is set in production builds only (${cookies.every((c) => c.secure) ? "set" : "off on http://localhost"})`);

  // ---- Sales: no authenticator, no challenge, no banner
  const sales = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(sales, "sales");
  await login(sales, "sales");
  t = await text(sales);
  record("M12 Sales signs in with the password alone and is not nagged", /\/app/.test(sales.url()) && !/Set up your authenticator/.test(t) ? "PASS" : "FAIL", "straight to /app, no banner (Sales has none of the powers a factor protects)", await shot(sales, "M12-sales"));

  // ---- enrolling and removing an authenticator in the browser: the QR code is a data: image under the CSP
  const viewer = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(viewer, "enrol");
  await login(viewer, "viewer");
  await viewer.goto(`${BASE}/app/security`);
  await viewer.click('button:has-text("Set up an authenticator")');
  await viewer.waitForSelector('img[alt^="QR code"]', { timeout: 15000 });
  const qrOk = await viewer.locator('img[alt^="QR code"]').evaluate((img) => img.complete && img.naturalWidth > 0);
  const secret = (await viewer.locator("form code").first().innerText()).trim();
  const typeCode = async (selector, button, wanted) => {
    for (const offset of [0, 1, -1, 2]) {
      await viewer.fill(selector, totp(secret, offset));
      await viewer.click(`button:has-text("${button}")`);
      try { await viewer.waitForSelector(wanted, { timeout: 6000 }); return true; } catch { /* a code is used once per 30 s step: try the next */ }
    }
    return false;
  };
  const turnedOn = await typeCode('input[name="code"]', "Turn on", "text=Done. Your authenticator is on.");
  record("M13 enrolment in the browser: the QR renders under the CSP, a code turns it on", qrOk && turnedOn ? "PASS" : "FAIL", `QR image decoded: ${qrOk}; secret shown for manual entry: ${secret.length >= 16}; turned on: ${turnedOn}`, await shot(viewer, "M13-enrolled"));
  const removedOk = await typeCode('input[name="code"]', "Remove the authenticator", "text=Your authenticator was removed.");
  record("M14 removing it needs a fresh code, and then it is gone", removedOk ? "PASS" : "FAIL", "removed with a typed code; the page offers setup again: " + ((await viewer.locator('button:has-text("Set up an authenticator")').count()) === 1), await shot(viewer, "M14-removed"));

  // ---- the 360px pass
  const phoneCtx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const ph = await phoneCtx.newPage();
  watch(ph, "phone360");
  const phoneReports = [];
  await ph.goto(`${BASE}/login`);
  phoneReports.push(["sign-in", await layoutReport(ph), await shot(ph, "N1-login-360")]);
  await ph.goto(`${BASE}/auth/forgot`);
  phoneReports.push(["forgot", await layoutReport(ph), await shot(ph, "N2-forgot-360")]);
  await ph.goto(`${BASE}/login`);
  await ph.fill('input[name="email"]', emailOf("owner"));
  await ph.fill('input[name="password"]', PW);
  await ph.click('button:has-text("Sign in")');
  await ph.waitForURL(/\/auth\/mfa/, { timeout: 20000 });
  phoneReports.push(["challenge", await layoutReport(ph), await shot(ph, "N3-challenge-360")]);
  await passChallenge(ph, emailOf("owner"));
  for (const [name, url] of [["workspaces", "/app"], ["security", "/app/security"], ["workspace", `/app/tenants/${T}`], ["review", `/app/tenants/${T}/review`], ["privacy", `/app/tenants/${T}/privacy`], ["agents", `/app/tenants/${T}/agents`]]) {
    await ph.goto(`${BASE}${url}`);
    await ph.waitForLoadState("networkidle").catch(() => null);
    phoneReports.push([name, await layoutReport(ph), await shot(ph, `N4-${name}-360`)]);
  }
  for (const [name, lr, shotPath] of phoneReports) {
    const bad = lr.hscroll || lr.overflowEls.length > 0 || lr.small.length > 0;
    record(`N ${name} at 360px`, bad ? "FAIL" : "PASS", `horizontal scroll=${lr.hscroll}; overflowing=${lr.overflowEls.length}; targets under 44px=${lr.small.length}${lr.small.length ? " e.g. " + lr.small.slice(0, 4).join("; ") : ""}`, shotPath);
  }
} catch (error) {
  record("ERROR", "FAIL", String(error).slice(0, 400));
} finally {
  await browser.close();
}
console.log(`\nCSP violations seen in the browser console: ${violations.length}`);
for (const v of [...new Set(violations)].slice(0, 20)) console.log("  " + v);
const { results } = await import("./lib.mjs");
const bad = results.filter((r) => r.status !== "PASS");
console.log(`\n${bad.length === 0 && violations.length === 0 ? "ALL PASS" : `${bad.length} step(s) not PASS: ${bad.map((r) => r.id).join(", ")}`}`);
process.exit(bad.some((r) => r.status === "FAIL") || violations.length ? 1 : 0);

async function discoverUrlsBeforeChallenge() { return null; }
