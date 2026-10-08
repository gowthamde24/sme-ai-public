// WebKit (the Safari engine, not Safari itself) and Firefox for audit:landing, through playwright-core (exact
// devDependency, owner's "deps ok", Stage 2 decision 4). LOCAL ONLY, never in CI: the browsers are not installed by
// npm; run `npx playwright-core install webkit firefox` once (they go to the user's cache folder, no sudo). Pages offer
// the same interface as the Chrome engine in engines.mjs. Each page gets its own browser context, so cookies and
// emulation never leak between pages. The browser is stopped through the library that launched it (no kill by name).
const INIT = "window.__csp=[];document.addEventListener('securitypolicyviolation',function(e){window.__csp.push(e.violatedDirective+' '+(e.blockedURI||'inline'))});";

export async function playwrightEngine(name) {
  if (!["webkit", "firefox"].includes(name)) throw new Error(`unknown engine "${name}" (chrome, webkit, firefox)`);
  const pw = await import("playwright-core");
  const browser = await pw[name].launch({ headless: true, ...(name === "firefox" ? { firefoxUserPrefs: { "ui.useOverlayScrollbars": 1 } } : {}) });
  return {
    name,
    needsHttps: true, // the production CSP upgrades insecure requests, which this engine applies to http://127.0.0.1 too (see tls-proxy.mjs)
    note: `${name} ${browser.version()} through playwright-core, headless, launched and closed by the script${name === "firefox" ? "; overlay scrollbars requested" : ""}`,
    async open({ width = 1200, height = 800, dark = false, reducedMotion = false } = {}) {
      const context = await browser.newContext({
        viewport: { width, height },
        ignoreHTTPSErrors: true, // the audit's own self-signed certificate (tls-proxy.mjs)
        colorScheme: dark ? "dark" : "light",
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
      });
      await context.addInitScript(INIT);
      const page = await context.newPage();
      const logs = [];
      page.on("console", (m) => {
        if (["error", "warning"].includes(m.type())) logs.push(`console.${m.type()}: ${m.text()}`);
      });
      page.on("pageerror", (e) => logs.push(`exception: ${e.message}`));
      return {
        async setCookie(base, cookieName, value) {
          await context.addCookies([{ name: cookieName, value, url: base }]);
        },
        async goto(url, settleMs = 900) {
          await page.goto(url, { waitUntil: "load", timeout: 30000 });
          await page.waitForTimeout(settleMs);
        },
        eval: (expression) => page.evaluate(expression),
        csp: () => page.evaluate("window.__csp || []"),
        getLogs: () => [...logs],
        async pressTab() {
          // Safari's engine on macOS leaves links out of the plain Tab order (a system setting, off by default);
          // Option+Tab walks every control, which is what a keyboard user of Safari uses.
          await page.keyboard.press(name === "webkit" ? "Alt+Tab" : "Tab");
          await page.waitForTimeout(60);
        },
        close: () => context.close(),
      };
    },
    stop: () => browser.close(),
  };
}
