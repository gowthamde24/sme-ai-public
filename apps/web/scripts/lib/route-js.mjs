// The JavaScript every page route loads on a first visit, from the build alone (job CF; used by scripts/audit-route-js.mjs and its test).
// A route loads the framework's root files (build-manifest.json "rootMainFiles") plus the chunks of every layout, loading, error and page segment on its way (the "entryJSFiles" of the route's
// page_client-reference-manifest.js): the very list Next puts in the page as <script src>. Chunks that are loaded later with next/dynamic are not in it (since job CJ the app has none for the owl or the Office).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** [{ route: "/app/tenants/[tenantId]/page", name: "/app/tenants/[tenantId]", bytes (gzip level 9), files }] for every page route of a build (`nextDir` = the .next folder), largest first. */
export function readRouteJs(nextDir) {
  const rootFiles = JSON.parse(fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8")).rootMainFiles;
  const sizes = new Map();
  const gzipSize = (file) => {
    if (!sizes.has(file)) sizes.set(file, zlib.gzipSync(fs.readFileSync(path.join(nextDir, file)), { level: 9 }).length);
    return sizes.get(file);
  };
  const rows = [];
  for (const file of walk(path.join(nextDir, "server", "app")).filter((f) => f.endsWith("page_client-reference-manifest.js"))) {
    const holder = {};
    new Function("globalThis", fs.readFileSync(file, "utf8"))(holder);
    for (const [route, entry] of Object.entries(holder.__RSC_MANIFEST ?? {})) {
      const files = new Set(rootFiles);
      for (const list of Object.values(entry.entryJSFiles ?? {})) for (const f of list) files.add(f);
      rows.push({ route, name: route.replace(/\/page$/, "") || "/", bytes: [...files].reduce((a, f) => a + gzipSize(f), 0), files: files.size });
    }
  }
  return rows.sort((a, b) => b.bytes - a.bytes);
}

/** Puts each route's limit next to it: an explicit entry of `budget.routes` wins; else a signed-in route (/app/...) gets `budget.app`, any other `budget.public`. `stale` = entries naming a route that is not in the build. */
export function judgeRouteJs(rows, budget) {
  const judged = rows.map((r) => {
    const explicit = r.route in budget.routes;
    const limit = explicit ? budget.routes[r.route] : r.name === "/app" || r.name.startsWith("/app/") ? budget.app : budget.public;
    return { ...r, limit, explicit, over: r.bytes > limit };
  });
  return { judged, stale: Object.keys(budget.routes).filter((k) => !rows.some((r) => r.route === k)) };
}
