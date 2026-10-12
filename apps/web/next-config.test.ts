// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config", () => {
  it("applies the security headers to every route and hides the framework", async () => {
    const rules = await (nextConfig.headers as () => Promise<{ source: string; headers: { key: string }[] }[]>)();
    expect(rules).toHaveLength(2);
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

  it("renders every page per request: a nonce CSP cannot work on statically prerendered HTML", () => {
    const layout = readFileSync(new URL("./app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/export const dynamic = "force-dynamic";/);
  });
});
