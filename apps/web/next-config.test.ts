// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import nextConfig from "./next.config";

describe("next.config", () => {
  it("is a standalone build only when asked (job DE: the container image), so dev, start and the demo scripts are unchanged", async () => {
    expect(nextConfig.output).toBeUndefined();
    const previous = process.env.NEXT_OUTPUT;
    process.env.NEXT_OUTPUT = "standalone";
    try {
      vi.resetModules();
      const { default: fresh } = await import("./next.config");
      expect(fresh.output).toBe("standalone");
      expect(fresh.outputFileTracingRoot).toBe(new URL("../..", import.meta.url).pathname.replace(/\/$/, "")); // the repository
    } finally {
      if (previous === undefined) delete process.env.NEXT_OUTPUT;
      else process.env.NEXT_OUTPUT = previous;
      vi.resetModules();
    }
  });

  it("applies the security headers to every route and hides the framework", async () => {
    const rules = await (nextConfig.headers as () => Promise<{ source: string; headers: { key: string }[] }[]>)();
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers.map((h) => h.key)).toEqual(
      expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"]),
    );
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("serves the offline worker fresh every time and for the whole site (job BL)", async () => {
    const rules = await (nextConfig.headers as () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>)();
    const sw = rules.find((r) => r.source === "/sw.js");
    expect(sw?.headers).toEqual(expect.arrayContaining([{ key: "Service-Worker-Allowed", value: "/" }, { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }]));
  });

  it("lets a returning visitor keep the app icons and share pictures for a day (job CF), and gives no page a Cache-Control rule", async () => {
    const rules = await (nextConfig.headers as () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>)();
    for (const source of ["/icons/:path*", "/og/:path*"]) {
      const rule = rules.find((r) => r.source === source);
      expect(rule?.headers, source).toEqual([{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }]);
    }
    // only these folders and the worker have a Cache-Control rule: a page must never be given one here (pages carry customer data and a nonce)
    expect(rules.filter((r) => r.headers.some((h) => h.key === "Cache-Control")).map((r) => r.source).sort()).toEqual(["/icons/:path*", "/og/:path*", "/owl/:path*", "/sw.js"]);
  });

  it("lets the plush owlet's pictures be kept for a year, as immutable (job CI follow-up): they live in a versioned folder, so a changed picture has a new address", async () => {
    const rules = await (nextConfig.headers as () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>)();
    expect(rules.find((r) => r.source === "/owl/:path*")?.headers).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
    // every file the owl component asks for is under /owl/v<N>/ (an unversioned name could never be changed once cached)
    const rig = readFileSync(new URL("./components/v2/app/owl/owl-files.ts", import.meta.url), "utf8");
    expect(rig).toMatch(/export const OWL_DIR = "\/owl\/v\d+";/);
  });

  it("renders every page per request: a nonce CSP cannot work on statically prerendered HTML", () => {
    const layout = readFileSync(new URL("./app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/export const dynamic = "force-dynamic";/);
  });
});
