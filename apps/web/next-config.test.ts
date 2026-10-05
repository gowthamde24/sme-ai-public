// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config", () => {
  it("applies the security headers to every route and hides the framework", async () => {
    const rules = await (nextConfig.headers as () => Promise<{ source: string; headers: { key: string }[] }[]>)();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers.map((h) => h.key)).toEqual(
      expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"]),
    );
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("renders every page per request: a nonce CSP cannot work on statically prerendered HTML", () => {
    const layout = readFileSync(new URL("./app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/export const dynamic = "force-dynamic";/);
  });
});
