// Browser engines for audit:landing. Each engine opens pages that offer the same small interface, so the checks are
// written once: goto(url), eval(expression), setCookie(base, name, value), pressTab(), csp(), getLogs(), close().
// Chrome (the system Chrome over the DevTools Protocol, no dependency) is built in.
import { startChrome, Tab } from "./chrome.mjs";

export async function chromeEngine() {
  const chrome = await startChrome(undefined, { hideScrollbars: true });
  return {
    name: "chrome",
    note: `system Chrome, headless, pid ${chrome.pid}; classic scrollbars hidden (--hide-scrollbars) as in the design-lab audits`,
    async open(opts) {
      return Tab.open(chrome.port, opts);
    },
    stop: chrome.stop,
  };
}
