import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../../..");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const files = [...walk(path.join(WEB, "components/v2")), ...walk(path.join(WEB, "app"))].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const isClient = (src: string) => /^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(src);
const resolve = (from: string, spec: string): string | null => {
  const base = spec.startsWith("@/") ? path.join(WEB, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
};

/**
 * Next.js turns every export of a "use client" file into a reference when a SERVER component imports it: a component can be rendered from the reference, but a constant, a function or an
 * array cannot be used (`ASK_WORD_KEYS.map is not a function` was found this way, in a browser, not by a unit test). So a server file may import only components (and types) from a client file.
 */
describe("a server component imports only components from a client component file", () => {
  it("holds for every file of the v2 screens and the app routes", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["'];?/gm)) {
        const target = resolve(f, m[2]);
        if (!target || !isClient(fs.readFileSync(target, "utf8"))) continue;
        const named = [...m[1].matchAll(/\b(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/g)].filter((n) => !/^type\s/.test(n[0]) && n[1] !== "type").map((n) => n[2] ?? n[1]);
        for (const name of named) if (!/^[A-Z]/.test(name) || /^[A-Z0-9_]+$/.test(name)) bad.push(`${path.relative(WEB, f)} imports ${name} from the client file ${path.relative(WEB, target)}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("and the check itself notices the mistake it was written for", () => {
    const src = 'import { ASK_WORD_KEYS, AskTeam } from "./ask/AskTeam";';
    const m = /^import\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["'];?/m.exec(src)!;
    const names = [...m[1].matchAll(/\b([A-Za-z_$][\w$]*)/g)].map((n) => n[1]).filter((n) => n !== "type");
    expect(names.filter((n) => !/^[A-Z]/.test(n) || /^[A-Z0-9_]+$/.test(n))).toEqual(["ASK_WORD_KEYS"]);
  });
});
