// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) return e === "node_modules" || e === ".next" ? [] : sources(full);
    return /\.tsx?$/.test(e) && !/\.test\./.test(e) ? [full] : [];
  });
}
const rel = (f: string) => path.relative(WEB, f);
const STATIC_APP_DICT = /^\s*import\s[^;]*from\s+["'](?:@\/i18n\/app|@\/i18n\/strings\/app\.json)["']/m;

/**
 * Job DH: the 1.3 MB app dictionary (strings/app.json, 1.7 MB of server code once bundled) belongs to the signed-in app only. Next includes the root not-found page in the server graph of EVERY route, and `not-found.tsx`
 * imported the dictionary statically, so a cold render of /login or of a public page read and compiled it for nothing. These files are in the graph of the public and sign-in routes (or of every route): none may import it
 * statically (a dynamic `await import()` inside a function that really needs it is fine).
 */
describe("the app dictionary stays out of the shared server graph", () => {
  const shared = [
    path.join(WEB, "app", "layout.tsx"),
    path.join(WEB, "app", "not-found.tsx"),
    path.join(WEB, "app", "global-error.tsx"),
    path.join(WEB, "app", "page.tsx"),
    ...sources(path.join(WEB, "app", "login")),
    ...sources(path.join(WEB, "app", "signup")),
    ...sources(path.join(WEB, "app", "auth")),
    ...sources(path.join(WEB, "app", "(legal)")),
    ...sources(path.join(WEB, "app", "[first]")),
    ...["auth", "legal", "site", "landing", "controls", "pwa", "robust"].flatMap((d) => (d === "robust" ? sources(path.join(WEB, "components", "v2", "app", "robust")) : sources(path.join(WEB, "components", "v2", d)))),
    path.join(WEB, "components", "v2", "V2Root.tsx"),
  ];
  it("no shared file imports the app dictionary statically", () => {
    expect(shared.length).toBeGreaterThan(40);
    const offenders = shared.filter((f) => STATIC_APP_DICT.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("the not-found page loads it only when a 404 is drawn", () => {
    const src = readFileSync(path.join(WEB, "app", "not-found.tsx"), "utf8");
    expect(src).toMatch(/await import\(["']@\/i18n\/app["']\)/);
  });
});
