// @vitest-environment node
/**
 * Guard tests: secrets must never reach apps/web, and server-only code must stay off the client.
 * They scan the source tree, so a future change that violates the rule fails CI immediately.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "coverage",
  "out",
  "build",
  ".git",
]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|md|env)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(entry) || entry.startsWith(".env")) out.push(full);
  }
  return out;
}

// This file legitimately contains the forbidden words (as patterns), so it is excluded.
const SELF = path.join(WEB_ROOT, "test", "guards.test.ts");
const files = walk(WEB_ROOT).filter(
  (f) => f !== SELF && !f.endsWith("package-lock.json"),
);

const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => path.relative(WEB_ROOT, file);

// Names that must not appear anywhere in apps/web.
const FORBIDDEN_NAMES: [string, RegExp][] = [
  ["service-role key", /service[_-]?role/i],
  ["JWT secret", /jwt[_-]?secret/i],
  ["Supabase secret key", /SUPABASE_SECRET/i],
  [
    "database URL / password",
    /(SUPABASE_)?DB_(URL|PASSWORD)|DATABASE_URL|POSTGRES_PASSWORD/,
  ],
  ["server JWT signing material", /SUPABASE_JWT_(SECRET|KEY)|JWKS_URL/i],
];

// The only NEXT_PUBLIC_ variables allowed: they are shipped to browsers.
const ALLOWED_PUBLIC = new Set([
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);

describe("no secrets in apps/web", () => {
  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.endsWith("proxy.ts"))).toBe(true);
  });

  it.each(FORBIDDEN_NAMES)(
    "contains no reference to the %s",
    (_label, pattern) => {
      const offenders = files.filter((f) => pattern.test(read(f))).map(rel);
      expect(offenders).toEqual([]);
    },
  );

  it("only exposes allow-listed NEXT_PUBLIC_ variables", () => {
    const found = new Set<string>();
    for (const file of files) {
      for (const match of read(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g))
        found.add(match[0]);
    }
    expect([...found].filter((name) => !ALLOWED_PUBLIC.has(name))).toEqual([]);
  });

  it("no NEXT_PUBLIC_ name hints at a secret", () => {
    const secretish = /(SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|JWT|ROLE)/;
    for (const name of ALLOWED_PUBLIC)
      expect(secretish.test(name.replace("ANON_KEY", ""))).toBe(false);
  });

  it(".env.example keeps secrets out of NEXT_PUBLIC_ variables and holds no real values", () => {
    const example = read(path.join(REPO_ROOT, ".env.example"));
    const active = example.split("\n").filter((l) => /^[A-Z_]+=/.test(l));
    const publicLines = active.filter((l) => l.startsWith("NEXT_PUBLIC_"));
    for (const line of publicLines) {
      const name = line.split("=")[0];
      expect(ALLOWED_PUBLIC.has(name), name).toBe(true);
    }
    for (const line of active) {
      const value = line.slice(line.indexOf("=") + 1);
      expect(value, line).not.toMatch(/eyJ|sb_secret_|sk[-_]/);
    }
  });

  it("does not read process.env dynamically (that would defeat the allow-list)", () => {
    const offenders = files
      .filter(
        (f) =>
          /\.(ts|tsx)$/.test(f) &&
          !f.endsWith(".test.ts") &&
          !f.endsWith(".test.tsx"),
      )
      .filter((f) =>
        /process\.env\[|\.\.\.process\.env|Object\.\w+\(process\.env\)/.test(
          read(f),
        ),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("server-only code stays on the server", () => {
  const sourceFiles = files.filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
  );
  const isClient = (f: string) =>
    /^\s*["']use client["']/m.test(read(f).split("\n").slice(0, 5).join("\n"));
  const SERVER_ONLY_IMPORTS = [
    "@/lib/supabase/server",
    "@/lib/supabase/proxy-session",
    "@/lib/auth/session",
    "@/lib/api/client",
    "next/headers",
    "@supabase/ssr",
    "@supabase/supabase-js",
  ];

  it("finds the client components it is meant to police", () => {
    expect(sourceFiles.filter(isClient).length).toBeGreaterThanOrEqual(2);
  });

  it("no 'use client' file imports server-only modules", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles.filter(isClient)) {
      const text = read(file);
      for (const mod of SERVER_ONLY_IMPORTS) {
        if (
          new RegExp(`from\\s+["']${mod.replace(/[/@.]/g, "\\$&")}["']`).test(
            text,
          )
        ) {
          offenders.push(`${rel(file)} -> ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the browser never creates a Supabase client (auth is server-side only)", () => {
    const offenders = sourceFiles
      .filter((f) => /createBrowserClient/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the only code allowed to call getSession() is the data-access layer, after getUser()", () => {
    const users = sourceFiles
      .filter((f) => /\.auth\.getSession\(/.test(read(f)))
      .map(rel);
    expect(users).toEqual([path.join("lib", "auth", "session.ts")]);
    const text = read(path.join(WEB_ROOT, "lib/auth/session.ts"));
    expect(text.indexOf("auth.getUser(")).toBeGreaterThan(-1);
    expect(text.indexOf("auth.getUser(")).toBeLessThan(
      text.indexOf("auth.getSession("),
    );
  });

  it("the web never talks to Supabase PostgREST: OUR API is the only door", () => {
    const patterns: [string, RegExp][] = [
      ["a /rest/v1 URL", /\/rest\/v1/],
      ["an .rpc() call", /\.rpc\(/],
      ["a supabase.from() query", /supabase\s*\.\s*from\(/],
      ["createClient from supabase-js", /\bcreateClient\b/],
    ];
    for (const [label, pattern] of patterns) {
      const offenders = sourceFiles
        .filter((f) => pattern.test(read(f)))
        .map(rel);
      expect(offenders, label).toEqual([]);
    }
  });

  it("only lib/api/client.ts calls fetch(), always to the configured API base", () => {
    const callers = sourceFiles
      .filter((f) => /\bfetch\(/.test(read(f)))
      .map(rel);
    expect(callers).toEqual([path.join("lib", "api", "client.ts")]);
    const client = read(path.join(WEB_ROOT, "lib/api/client.ts"));
    expect(client).toMatch(/fetch\(`\$\{base\}\$\{path\}`/);
  });

  it("the Supabase client is imported only by the auth plumbing, never by CRM pages or clients", () => {
    const importers = sourceFiles
      .filter((f) => !rel(f).startsWith(path.join("lib", "supabase")))
      .filter((f) => /@\/lib\/supabase\//.test(read(f)))
      .map(rel)
      .sort();
    expect(importers).toEqual(
      [
        path.join("app", "app", "actions.ts"),
        path.join("app", "login", "actions.ts"),
        path.join("lib", "auth", "session.ts"),
        "proxy.ts",
      ].sort(),
    );
    const crm = sourceFiles.filter(
      (f) =>
        rel(f).startsWith(path.join("app", "app", "tenants")) ||
        rel(f).startsWith(path.join("lib", "api")),
    );
    expect(crm.length).toBeGreaterThanOrEqual(4);
    for (const file of crm) expect(read(file)).not.toMatch(/supabase/i);
  });

  it("session cookies are written HttpOnly", () => {
    expect(read(path.join(WEB_ROOT, "lib/supabase/cookies.ts"))).toMatch(
      /httpOnly:\s*true/,
    );
  });
});
