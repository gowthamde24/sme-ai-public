import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import dict from "@/i18n/strings/app.json";

/**
 * Job BK: the screens of the workspace say their words through the string store (`t("key")`), in four languages. Two pins keep it that way:
 *  1. no screen draws English straight in its markup (JSX text, or a placeholder / aria-label / title / alt / label / data-label attribute), except the few code-like examples below;
 *  2. every `t("literal.key")` a screen asks for exists in the store (a missing key would show the raw key to the person).
 */
const WEB = process.cwd(); // vitest runs from apps/web
const SCREENS = path.join(WEB, "app/app");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "golden" || e.name === "node_modules" ? [] : files(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** Code-like text that is meant to be read in Latin letters in every language (a file column, an example reference), not a sentence. */
const CODE_LIKE = new Set([
  "doc:invoice-12",
  "call-2026-10-08",
  "sku,name,unit_price,moq,tax_bps",
  "sku, name, unit_price, moq, tax_bps",
  "min_qty_1, price_1",
  "min_qty_5, price_5",
  "company_name",
  "city",
  "country",
  "website",
  "industry",
  "buyer_type",
  "contact_name",
  "contact_phone",
  "contact_email",
  "example.test",
  "my-business",
]);
const ATTRS = /^(placeholder|aria-label|title|alt|label|data-label)$/;

function hardCoded(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const text = n.getText().replace(/\s+/g, " ").trim();
      if (/[A-Za-z]{2,}/.test(text) && !CODE_LIKE.has(text)) found.push(text);
    } else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATTRS.test(n.name.getText())) {
      const text = n.initializer.text;
      if (/[A-Za-z]{2,}/.test(text) && !CODE_LIKE.has(text)) found.push(text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("the workspace screens keep their words in the string store", () => {
  const all = files(SCREENS);

  it("draw no English straight in their markup", () => {
    const bad = all.flatMap((f) => hardCoded(f).map((t) => `${path.relative(SCREENS, f)}: ${t.slice(0, 80)}`));
    expect(bad).toEqual([]);
  });

  it("only ask for keys the string store has", () => {
    const keys = dict as Record<string, unknown>;
    const asked = /\b(?:t|say)\(\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)"|\bk="([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)"|labelOr\(t,\s*[^,]+,\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)"/g;
    const missing: string[] = [];
    for (const f of all) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(asked)) {
        const key = m[1] ?? m[2] ?? m[3];
        if (!(key in keys)) missing.push(`${path.relative(SCREENS, f)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
