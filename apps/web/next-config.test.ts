// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config", () => {
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
    // only these two folders and the worker have a Cache-Control rule: a page must never be given one here (pages carry customer data and a nonce)
    expect(rules.filter((r) => r.headers.some((h) => h.key === "Cache-Control")).map((r) => r.source).sort()).toEqual(["/icons/:path*", "/og/:path*", "/sw.js"]);
  });

  it("renders every page per request: a nonce CSP cannot work on statically prerendered HTML", () => {
    const layout = readFileSync(new URL("./app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/export const dynamic = "force-dynamic";/);
  });
});
