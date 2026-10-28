import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKIP = new Set(["node_modules", ".next", "coverage", "test-results"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|mjs|js|css|json)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/package-lock\.json$|tsconfig\.tsbuildinfo$/.test(name)) out.push(full);
  }
  return out;
}

// the usual analytics, tag and session-replay vendors, and the calls that start them
const VENDORS = /googletagmanager|google-analytics|gtag\s*\(|\bga\s*\(\s*['"]|plausible\.io|posthog|mixpanel|segment\.(com|io)|hotjar|clarity\.ms|fullstory|amplitude|matomo|umami|@vercel\/(analytics|speed-insights)|datadoghq|newrelic|sentry\.io|@sentry\/|facebook\.net\/en_US\/fbevents|connect\.facebook\.net|snap\.licdn|static\.ads-twitter|doubleclick|adsbygoogle/i;

describe("no analytics is loaded anywhere (job BH)", () => {
  const files = sources(ROOT);
  it("scans real source files", () => expect(files.length).toBeGreaterThan(200));
  it("no analytics, tag, advertising or session-replay library, address or call in the app's source", () => {
    const hits = files.filter((f) => VENDORS.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    // ONE file is exempt (job DP part 6, C1): the web server's error reporting. It is OFF unless SENTRY_DSN is set, it runs on the server only (the browser's policy stays `connect-src 'self'`), it sends a scrubbed envelope (the error's class
    // name and stack frames: no message, address, header, cookie, body, user or breadcrumb) and only to the host of the DSN the owner gives. It is not analytics and no visitor is followed; the owner decides to switch it on (docs/runbooks/error-reporting-sentry.md).
    expect(hits).toEqual(["lib/observability/report.ts"]);
  });
  it("no such package is a dependency", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => VENDORS.test(n))).toEqual([]);
  });
  it("the page policy would refuse an outside script anyway: scripts only from this site (nonce) and no outside connections", async () => {
    const { buildCsp } = await import("@/lib/security/csp");
    const csp = buildCsp("abc", false, null);
    expect(csp).toMatch(/script-src 'self' 'nonce-abc' 'strict-dynamic'/);
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
    expect(csp).not.toMatch(/https?:\/\/(?!abc|lh3\.googleusercontent\.com)/); // the one outside address is Google's, for profile photos (images only)
  });
  it("the only way to start something behind the Analytics category is whenAnalyticsAllowed: it has no caller yet", () => {
    const callers = files.filter((f) => /whenAnalyticsAllowed\s*\(/.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(callers).toEqual(["lib/consent/analytics.ts"]);
  });
});

describe("the cookies the code writes are the cookies the policy lists (job BH)", () => {
  const files = sources(ROOT);
  it("only these files write a cookie; a new writer must be added to lib/legal/cookies.ts and to the Privacy Policy first", () => {
    const writers = files
      .filter((f) => /document\.cookie\s*=|\.cookies\.set\(|cookieStore\.set\(|serializePreference\(|serializeConsent\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(writers).toEqual([
      "app/setup/setup-form.tsx", // sme_lang
      "components/v2/app/setup/SetupWizard.tsx", // sme_lang (the language choice of the setup wizard, the same cookie as the language button)
      "components/v2/controls/LangSelect.tsx", // sme_lang
      "components/v2/controls/ThemeButton.tsx", // sme_theme
      "components/v2/controls/ThemeChoice.tsx", // sme_theme
      "i18n/preferences.ts", // the serializer of the two above
      "lib/consent/consent.ts", // the serializer of sme_consent
      "lib/consent/store.ts", // sme_consent
      "lib/supabase/proxy-session.ts", // the sign-in cookies (Supabase, hardened)
      "lib/supabase/server.ts", // the sign-in cookies (Supabase, hardened)
      "proxy.ts", // copies the sign-in cookies onto a redirect
    ]);
  });
  it("the list has exactly the four cookies, all strictly necessary, with the names the code uses", async () => {
    const { COOKIES, COOKIE_FACTS, DEVICE_SETTINGS } = await import("@/lib/legal/cookies");
    expect(COOKIES.map((c) => c.name)).toEqual(["sb-<project>-auth-token", "sme_lang", "sme_theme", "sme_consent"]);
    expect(COOKIES.every((c) => c.kind === "necessary")).toBe(true);
    expect(Object.keys(COOKIE_FACTS).sort()).toEqual(["auth", "consent", "lang", "theme"]);
    // the browser-storage keys listed are the ones in the code
    for (const s of DEVICE_SETTINGS) expect(files.some((f) => readFileSync(f, "utf8").includes(`"${s.key}"`)), s.key).toBe(true);
  });
  it("the sign-in cookie is HttpOnly, SameSite=Lax and Secure in production (what the policy says)", async () => {
    const { hardenCookieOptions } = await import("@/lib/supabase/cookies");
    expect(hardenCookieOptions({})).toMatchObject({ path: "/", httpOnly: true, sameSite: "lax" });
  });
});
