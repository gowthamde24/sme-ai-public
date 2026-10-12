import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Job CE (ADR 0072): with the web at app.<domain> and the API at api.<domain>, the session cookie must never travel to the API and the browser must never call the API itself. The web SERVER calls the API with the
 * person's token in an Authorization header; the browser only talks to this site (`credentials: "same-origin"`). These checks read the source so a change that breaks the arrangement fails here.
 */
const ROOT = join(__dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the browser and the API", () => {
  const files = ["app", "components", "lib"].flatMap((d) => sources(join(ROOT, d)));

  it("no code asks the browser to send its cookies to another site (credentials: include)", () => {
    const offenders = files.filter((f) => /credentials\s*:\s*["']include["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the API's address is read only on the server side of the web (lib/api/client.ts), never in a component that runs in the browser", () => {
    const readers = files.filter((f) => f.includes("NEXT_PUBLIC_API_BASE_URL") || /process\.env\.NEXT_PUBLIC_API_BASE_URL/.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
    expect(readers.every((f) => f.startsWith("lib/"))).toBe(true);
  });

  it("the API client sends the person's token as a Bearer header and never a cookie", () => {
    const client = readFileSync(join(ROOT, "lib", "api", "client.ts"), "utf8");
    expect(client).toMatch(/Authorization/);
    expect(client).not.toMatch(/[Cc]ookie/);
  });
});
