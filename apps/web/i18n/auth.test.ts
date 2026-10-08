import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AUTH_CHROME_KEYS, authDict, authT } from "@/i18n/auth";
import { LANGS } from "@/i18n/lang";

const ROOT = path.resolve(__dirname, "..");
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));

describe("auth chrome dictionary", () => {
  it("has exactly the eight chrome keys, non-empty, in every language", () => {
    expect(AUTH_CHROME_KEYS).toHaveLength(8);
    for (const l of LANGS) {
      expect(Object.keys(authDict(l))).toEqual([...AUTH_CHROME_KEYS]);
      for (const k of AUTH_CHROME_KEYS) expect(authDict(l)[k].trim().length, `${l} ${k}`).toBeGreaterThan(0);
    }
  });
  it("gives a different heading per language, and English matches the store", () => {
    expect(new Set(LANGS.map((l) => authDict(l)["side.title"])).size).toBe(4);
    expect(authT("en")("home")).toBe("Back to the home page");
  });
  it("uses none of the simulator words that differ from the real screens", () => {
    const all = JSON.stringify(LANGS.map((l) => authDict(l)));
    expect(all).not.toMatch(/Coming soon|do not keep you signed in|Request early access|E-mail/);
  });
  it("no client component imports it (the four dictionaries must not reach the browser bundle)", () => {
    const offenders = [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "app"))]
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) => {
        const src = fs.readFileSync(f, "utf8");
        return /^["']use client["']/m.test(src.split("\n").slice(0, 3).join("\n")) && /@\/i18n\/auth["']/.test(src);
      });
    expect(offenders).toEqual([]);
  });
});
