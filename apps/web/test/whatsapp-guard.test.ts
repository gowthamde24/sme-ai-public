// @vitest-environment node
/**
 * The WhatsApp number rule lives in ONE file, `lib/whatsapp/link.ts`, and only the redirect route may import it (docs/plans/open-in-whatsapp-plan.md, section 2): a page, a component, a server action or any other
 * module that imported it could put a phone number into page text, a prop or an action result. `lib/whatsapp/limit.ts` holds no number and may be imported by a page.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "coverage", "out", "build", ".git"]);
const ROUTE = path.join("app", "app", "tenants", "[tenantId]", "quotes", "[quoteId]", "whatsapp", "route.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = walk(WEB_ROOT);
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(WEB_ROOT, f);
const IMPORTS_LINK = /from\s+["'](@\/lib\/whatsapp\/link|(\.{1,2}\/)+[\w./-]*whatsapp\/link|\.\/link)["']/;
const IMPORTS_PHONE = /from\s+["'](@\/lib\/api\/contact-phone|(\.{1,2}\/)+[\w./-]*api\/contact-phone|\.\/contact-phone)["']/;

describe("the WhatsApp number rule is imported by the redirect route only", () => {
  it("finds the files it polices", () => {
    expect(sources.some((f) => rel(f) === path.join("lib", "whatsapp", "link.ts"))).toBe(true);
    expect(sources.length).toBeGreaterThan(50);
  });

  it("no file but the route imports lib/whatsapp/link", () => {
    const importers = sources.filter((f) => rel(f) !== path.join("lib", "whatsapp", "link.ts") && IMPORTS_LINK.test(read(f))).map(rel);
    expect(importers.filter((f) => f !== ROUTE)).toEqual([]);
  });

  it("the same holds for the one function that reads a contact's phone (lib/api/contact-phone.ts)", () => {
    expect(sources.some((f) => rel(f) === path.join("lib", "api", "contact-phone.ts"))).toBe(true);
    const importers = sources.filter((f) => rel(f) !== path.join("lib", "api", "contact-phone.ts") && IMPORTS_PHONE.test(read(f))).map(rel);
    expect(importers).toEqual([ROUTE]);
  });

  it("the redirect route exists and is the importer of the number rule", () => {
    const importers = sources.filter((f) => rel(f) !== path.join("lib", "whatsapp", "link.ts") && IMPORTS_LINK.test(read(f))).map(rel);
    expect(importers).toEqual([ROUTE]);
  });

  it("no 'use client' file imports it, and no 'use server' file does", () => {
    for (const f of sources) {
      const head = read(f).split("\n").slice(0, 5).join("\n");
      if (/^\s*["']use (client|server)["']/m.test(head)) expect(IMPORTS_LINK.test(read(f)) || IMPORTS_PHONE.test(read(f)), rel(f)).toBe(false);
    }
  });

  it("the number rule has no logging, no fetch and no way out except its return values", () => {
    const text = read(path.join(WEB_ROOT, "lib", "whatsapp", "link.ts"));
    const code = text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/console\.|fetch\(|process\.env|throw |import .* from "@\/lib\/(api|auth|supabase)/);
  });

  it("the limit file holds no number logic", () => {
    const text = read(path.join(WEB_ROOT, "lib", "whatsapp", "limit.ts"));
    const code = text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/wa\.me|whatsappDigits|INDIAN_MOBILE|phone/i);
  });
});

describe("the quote screen's WhatsApp controls hold no number and open nothing themselves", () => {
  const actions = path.join("app", "app", "tenants", "[tenantId]", "enquiries", "whatsapp-actions.tsx");
  const code = (f: string) => read(path.join(WEB_ROOT, f)).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("every href is an internal path built from the validated ids", () => {
    const hrefs = [...code(actions).matchAll(/href=(\{(?:[^{}]|\$\{[^{}]*\})*\}|"[^"]*")/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const h of hrefs) expect(h, h).toMatch(/^\{(route|`\$\{route\}\?chat=1`|`\/app\/tenants\/\$\{tenantId\}\/contacts\/\$\{view\.consentContactId\}\/consent`)\}$/);
  });

  it("an anchor that opens a new tab says noopener noreferrer", () => {
    const text = code(actions);
    expect((text.match(/target="_blank"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((text.match(/rel="noopener noreferrer"/g) ?? []).length).toBe((text.match(/target="_blank"/g) ?? []).length);
  });

  it("no source file but the number rule contains a wa.me address, and none opens a window, prefetches the route or links to a tel: address", () => {
    const offenders: string[] = [];
    for (const f of sources) {
      if (rel(f) === path.join("lib", "whatsapp", "link.ts")) continue;
      const text = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      if (/wa\.me|["'`]tel:|window\.open\(|api\.whatsapp\.com/.test(text)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });

  it("the controls are a plain anchor, never a prefetching Link, for the redirect route", () => {
    const text = code(actions);
    expect(text).not.toMatch(/<Link[^>]*\bhref=\{route/);
  });
});
