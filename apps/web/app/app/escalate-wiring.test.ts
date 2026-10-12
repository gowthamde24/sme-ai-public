import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Job CC, screen 7: a page that read something and failed does not show "the service is unreachable" for a refused call (403) or a rate-limited one (429): those go to the friendly pages of job BW (/app/problem/403 and /429).
 * Every screen's whole-page failure handler ends in `escalate(error)` (lib/api/failure.ts), which also sends a rejected session to sign-in. This pins it, so a page added later cannot forget.
 */
const SCREENS = path.join(process.cwd(), "app/app");
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(full);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}
/** Every `catch (x) { ... }` block of a source file that deals with a rejected session and ends by drawing the "service is down" part or by throwing the error on. */
function wholePageHandlers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/catch \((error|e)\) \{\n([\s\S]*?)\n\s*\}/g)) {
    const body = m[2];
    if (!body.includes("ApiAuthError") || !body.includes('redirect("/login")')) continue;
    const last = body.split("\n").filter((l) => l.trim() !== "").pop()?.trim() ?? "";
    if (last.includes("ApiDown") || last.startsWith("throw ")) out.push(body);
  }
  return out;
}
// the server actions return sentences for their forms (a redirect would lose what was typed): they keep their own handlers
const ACTIONS = /(actions|-actions)\.tsx?$/;

describe("every whole-page failure handler escalates a refusal and a rate limit", () => {
  const all = files(SCREENS).filter((f) => !ACTIONS.test(f));
  const handlers = all.flatMap((f) => wholePageHandlers(fs.readFileSync(f, "utf8")).map((body) => ({ f: path.relative(SCREENS, f), body })));
  it("finds the handlers it polices (about sixty)", () => {
    expect(handlers.length).toBeGreaterThan(50);
  });
  it("each one calls escalate(error) before it draws the failure page or throws", () => {
    expect(handlers.filter((h) => !/escalate\((error|e)\);/.test(h.body)).map((h) => h.f)).toEqual([]);
  });
  it("and every such file imports it from lib/api/failure", () => {
    const missing = all.filter((f) => /escalate\(/.test(fs.readFileSync(f, "utf8")) && !/import \{[^}]*\bescalate\b[^}]*\} from "@\/lib\/api\/failure";/.test(fs.readFileSync(f, "utf8")));
    expect(missing.map((f) => path.relative(SCREENS, f))).toEqual([]);
  });
});
