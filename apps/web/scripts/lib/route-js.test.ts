// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { judgeRouteJs, readRouteJs } from "./route-js.mjs";

type Row = { route: string; name: string; bytes: number; files: number };
type Judged = Row & { limit: number; explicit: boolean; over: boolean };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "route-js-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const chunk = (name: string, text: string) => {
  fs.mkdirSync(path.join(dir, "static", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "static", "chunks", name), text);
  return zlib.gzipSync(Buffer.from(text), { level: 9 }).length;
};
const manifest = (route: string, entries: Record<string, string[]>) => {
  const file = path.join(dir, "server", "app", route, "page_client-reference-manifest.js");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST[${JSON.stringify(`${route === "." ? "" : "/" + route}/page`)}] = ${JSON.stringify({ entryJSFiles: entries })};\n`);
};

// the framework's two root files, one chunk shared by two segments, one chunk only the signed-in page has
const root1 = chunk("root1.js", "r".repeat(4000) + Math.random());
const root2 = chunk("root2.js", "s".repeat(3000) + Math.random());
const shared = chunk("shared.js", "x".repeat(2000) + Math.random());
const heavy = chunk("heavy.js", Array.from({ length: 500 }, (_, i) => `f${i}=${Math.random()}`).join(";"));
fs.writeFileSync(path.join(dir, "build-manifest.json"), JSON.stringify({ rootMainFiles: ["static/chunks/root1.js", "static/chunks/root2.js"] }));
manifest("landing", { "[project]/app/layout": ["static/chunks/shared.js"], "[project]/app/landing/page": ["static/chunks/shared.js"] });
manifest("app/tenants/[tenantId]", { "[project]/app/layout": ["static/chunks/shared.js"], "[project]/app/app/layout": ["static/chunks/shared.js", "static/chunks/heavy.js"], "[project]/app/app/tenants/[tenantId]/page": ["static/chunks/heavy.js"] });

describe("readRouteJs", () => {
  it("adds the root files and every chunk on the way once, and gzips each file at level 9", () => {
    const rows = readRouteJs(dir) as Row[];
    expect(rows.map((r) => r.route)).toEqual(["/app/tenants/[tenantId]/page", "/landing/page"]);
    const [app, landing] = rows;
    expect(landing.bytes).toBe(root1 + root2 + shared);
    expect(landing.files).toBe(3);
    expect(app.bytes).toBe(root1 + root2 + shared + heavy); // the chunk named by two segments counts once
    expect(app.files).toBe(4);
    expect(app.name).toBe("/app/tenants/[tenantId]");
  });
});

describe("judgeRouteJs", () => {
  const rows = [
    { route: "/app/tenants/[tenantId]/page", name: "/app/tenants/[tenantId]", bytes: 200_000, files: 14 },
    { route: "/login/page", name: "/login", bytes: 150_000, files: 9 },
    { route: "/app/page", name: "/app", bytes: 100_000, files: 12 },
  ] as Row[];
  const budget = { public: 155_000, app: 180_000, routes: { "/app/tenants/[tenantId]/page": 205_000 } };
  it("holds a named route to its own number, a signed-in route to the app default and any other to the public default", () => {
    const { judged, stale } = judgeRouteJs(rows, budget) as { judged: Judged[]; stale: string[] };
    expect(judged.map((j) => [j.name, j.limit, j.explicit, j.over])).toEqual([
      ["/app/tenants/[tenantId]", 205_000, true, false],
      ["/login", 155_000, false, false],
      ["/app", 180_000, false, false],
    ]);
    expect(stale).toEqual([]);
  });
  it("flags a route that grew past its number, and an entry for a route that is gone", () => {
    const grown = rows.map((r) => (r.name === "/login" ? { ...r, bytes: 155_001 } : r));
    const { judged, stale } = judgeRouteJs(grown, { ...budget, routes: { ...budget.routes, "/gone/page": 1 } }) as { judged: Judged[]; stale: string[] };
    expect(judged.filter((j) => j.over).map((j) => j.name)).toEqual(["/login"]);
    expect(stale).toEqual(["/gone/page"]);
  });
});
