// A minimal headless-Chrome driver over the DevTools Protocol for the audits. No dependency: Node's built-in fetch and
// WebSocket, and the SYSTEM Chrome only (CHROME_PATH, or a standard install path). It starts exactly one Chrome,
// records its PID and stops it by PID; it never kills anything by name and never touches a port that is already in
// use. The profile lives in a fixed folder under the OS temp directory and is reused (nothing is deleted).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function findChrome() {
  const found = [process.env.CHROME_PATH, ...CANDIDATES].filter(Boolean).find((p) => fs.existsSync(p));
  if (!found) throw new Error("No system Chrome found. Install Chrome or set CHROME_PATH (no browser is downloaded).");
  return found;
}

async function waitFor(fn, what, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not ready yet */
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function portIsFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
    return false;
  } catch {
    return true;
  }
}

/** Starts one headless Chrome with remote debugging on `port` (default 9335). Returns { port, pid, stop }. */
export async function startChrome(port = Number(process.env.DEBUG_PORT ?? 9335), { hideScrollbars = false } = {}) {
  if (!(await portIsFree(port))) throw new Error(`debug port ${port} is already in use; not touching it (set DEBUG_PORT)`);
  const profile = path.join(os.tmpdir(), "sme-ai-audit-chrome-profile");
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(
    findChrome(),
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", ...(hideScrollbars ? ["--hide-scrollbars"] : []), "about:blank"],
    { stdio: "ignore" },
  );
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, "Chrome");
  const stop = () => {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stop);
  return { port, pid: child.pid, stop };
}

export class Tab {
  static async open(port, { width = 1200, height = 800, dark = false, reducedMotion = false, mobile = false } = {}) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const tab = new Tab(ws, target.id, port);
    await tab.send("Page.enable");
    await tab.send("Runtime.enable");
    await tab.send("Log.enable");
    await tab.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await tab.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
        { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" },
      ],
    });
    // Every Content-Security-Policy violation, from the first byte of every new document.
    await tab.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__csp=[];document.addEventListener('securitypolicyviolation',function(e){window.__csp.push(e.violatedDirective+' '+(e.blockedURI||'inline'))});",
    });
    return tab;
  }

  constructor(ws, id, port) {
    this.ws = ws;
    this.id = id;
    this.port = port;
    this.n = 0;
    this.pending = new Map();
    this.logs = []; // console errors and warnings, uncaught exceptions, browser log errors
    this.loadWaiters = [];
    ws.addEventListener("message", (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) this.logs.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
      else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) this.logs.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      else if (msg.method === "Runtime.exceptionThrown") this.logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
      else if (msg.method === "Page.loadEventFired") this.loadWaiters.splice(0).forEach((f) => f());
    });
  }

  send(method, params = {}) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /** Navigates and waits for the load event (or 15 s), then a short settle for hydration. */
  async goto(url, settleMs = 900) {
    const loaded = new Promise((resolve) => this.loadWaiters.push(resolve));
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(settleMs);
  }

  async setCookie(url, name, value) {
    await this.send("Network.setCookie", { url, name, value });
  }

  /** A real key press (keyDown + keyUp), so :focus-visible behaves as it does for a keyboard user. */
  async pressTab() {
    const base = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(60);
  }

  /** Console errors and warnings, uncaught exceptions and browser log errors since the page opened. */
  getLogs() {
    return [...this.logs];
  }

  /** Content-Security-Policy violations seen since the last navigation. */
  csp() {
    return this.eval("window.__csp || []");
  }

  /** Replaces the page with this HTML (an inline document, so its stylesheets are same-origin readable). */
  async setHtml(html) {
    const { frameTree } = await this.send("Page.getFrameTree");
    await this.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async close() {
    this.ws.close();
    try {
      await fetch(`http://127.0.0.1:${this.port}/json/close/${this.id}`);
    } catch {
      /* ignore */
    }
  }
}
