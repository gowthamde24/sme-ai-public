// "Continue with Google" on the sign-in page of STAGING, end to end up to Google's own page, where it STOPS: no Google account, password or code is ever typed, read or stored.
// Usage:  node e2e/staging-google-signin.mjs <web url>
// Checks: (1) the button is on /login at phone and desktop size; (2) sign-up is still closed and has no Google button; (3) a click goes through our server to the Auth server
// (it asks to come back to <web>/auth/callback) and from there to accounts.google.com with the staging OAuth client and the Auth server's own callback as the return; (4) the return with
// "sign-up is off" (what the Auth server sends for an address without an account) ends on the sign-in page with the plain sentence, and a plain refusal with the generic one.
// SAFETY: runs only against the stack19-staging web address; nothing is created, no secret is used.
import { chromium } from "playwright";

const WEB = (process.argv[2] || "").replace(/\/$/, "");
const SUPABASE_REF = "uiallwgywitryxatcqxf";
if (!/^https:\/\/(sme-web-620338396268\.asia-south1\.run\.app|staging\.stack19\.com)$/.test(WEB)) {
  console.error("staging-google-signin: refusing to run: the first argument must be the stack19-staging web address.");
  process.exit(2);
}

let failed = 0;
const record = (id, ok, note) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} :: ${note}`);
};

const browser = await chromium.launch();
for (const [size, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const authorize = [];
  let googleAsk = null; // Google's first request (the Auth server's redirect): it carries the client and the return address, which Google's own pages later move into other parameters
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/authorize")) authorize.push(r.url());
    if (!googleAsk && r.url().startsWith("https://accounts.google.com/o/oauth2/")) googleAsk = new URL(r.url());
  });
  try {
    await page.goto(`${WEB}/login`);
    const button = page.getByRole("button", { name: "Continue with Google" });
    record(`${size}: /login shows Continue with Google`, await button.isVisible(), "the button is there");

    // the cookie notice may sit over the bottom of a phone: answer it as a visitor would
    const accept = page.getByRole("button", { name: /^OK, got it$/ });
    if (await accept.isVisible().catch(() => false)) await accept.click().catch(() => null);

    // the click ends on Google's page and stops there
    // "commit": the navigation has started on Google's side; Google's own page is heavy and its load event is not what is being tested
    await Promise.all([page.waitForURL(/^https:\/\/accounts\.google\.com\//, { timeout: 30000, waitUntil: "commit" }), button.click()]);
    const g = new URL(page.url());
    record(`${size}: the click lands on Google's page`, g.host === "accounts.google.com", `${g.host}${g.pathname}`);
    record(`${size}: Google is asked to return to the Auth server's callback`, googleAsk?.searchParams.get("redirect_uri") === `https://${SUPABASE_REF}.supabase.co/auth/v1/callback`, "redirect_uri");
    record(`${size}: the OAuth client is the staging one`, /^620338396268-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(googleAsk?.searchParams.get("client_id") || ""), "client_id shape");
    const asked = authorize.map((u) => new URL(u)).find((u) => u.host === `${SUPABASE_REF}.supabase.co`);
    record(`${size}: the Auth server was asked to come back to /auth/callback of the web`, asked?.searchParams.get("redirect_to") === "https://staging.stack19.com/auth/callback", `redirect_to ${asked?.searchParams.get("redirect_to") ?? "(none)"}`);
    record(`${size}: PKCE is used (no token ever comes back in an address)`, Boolean(asked?.searchParams.get("code_challenge")), "code_challenge present");
    // Google's page is where this test ends: nothing is typed there.

    // sign-up stays closed and has no Google button
    await page.goto(`${WEB}/signup`);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    record(`${size}: /signup has no Google button`, !/Continue with Google/i.test(body), "closed sign-up draws no provider");

    // what the Auth server sends back for an address without an account, and for any other refusal
    await page.goto(`${WEB}/auth/callback?error=unprocessable_entity&error_code=signup_disabled`);
    const none = (await page.locator('[role="status"]').first().innerText().catch(() => "")).replace(/\s+/g, " ");
    record(`${size}: an address without an account gets the plain sentence`, /no account for that Google address/.test(none) && new URL(page.url()).pathname === "/login", none.slice(0, 80));
    await page.goto(`${WEB}/auth/callback?error=access_denied`);
    const generic = (await page.locator('[role="status"]').first().innerText().catch(() => "")).replace(/\s+/g, " ");
    record(`${size}: any other refusal gets the generic sentence`, /could not sign you in with that provider/.test(generic), generic.slice(0, 80));
  } catch (e) {
    record(`${size}: the flow ran`, false, String(e).slice(0, 160));
  }
  await context.close();
}
await browser.close();
console.log(`staging-google-signin: ${failed === 0 ? "all passed" : `${failed} failed`}`);
process.exit(failed === 0 ? 0 : 1);
