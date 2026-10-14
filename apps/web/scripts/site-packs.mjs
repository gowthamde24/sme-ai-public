// The public website's view of the business types (job CM, blueprint section 13: "the web reads the same files at build time for landing pages"). Reads packages/packs/<id>/pack.json (names, summary, accent,
// owl prop, status, the owl team's words) and packages/packs/<id>/landing.json (the words and blocks of the public page) and writes lib/site/site-packs.generated.json, which the server-rendered pages import.
// Only a pack that HAS a landing.json and is not a draft gets a public page. The file is committed so the Docker build (which copies apps/web only) needs no access to packages/packs, and a test fails when it is stale.
//   node scripts/site-packs.mjs            write the file
//   node scripts/site-packs.mjs --check    exit 1 when the committed file is not what the pack files give (run by `make packs-check` and by a test)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKS_DIR = path.resolve(HERE, "..", "..", "..", "packages", "packs");
export const OUT = path.resolve(HERE, "..", "lib", "site", "site-packs.generated.json");
const LANGS = ["en", "te", "hi", "kn"];

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** The pack's owl-team words (`agent.*` labels) by owl, each in every language it has. */
function agentNames(labels) {
  const out = {};
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(labels[lang] ?? {})) {
      if (!key.startsWith("agent.")) continue;
      (out[key.slice("agent.".length)] ??= {})[lang] = text;
    }
  }
  return out;
}

export function buildSitePacks(packsDir = PACKS_DIR) {
  const packs = [];
  for (const entry of fs.readdirSync(packsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packFile = path.join(packsDir, entry.name, "pack.json");
    const landingFile = path.join(packsDir, entry.name, "landing.json");
    if (!fs.existsSync(packFile) || !fs.existsSync(landingFile)) continue;
    const pack = read(packFile);
    if (pack.status === "draft") continue;
    const landing = read(landingFile);
    delete landing.$schema; // the page does not need the file's own header
    delete landing.pack;
    packs.push({
      id: pack.id,
      status: pack.status,
      validated: pack.status === "published",
      names: pack.names,
      summary: pack.summary,
      accent: pack.accent,
      owlProp: pack.owl_prop,
      agents: agentNames(pack.labels),
      ...landing,
    });
  }
  // the API's order for the sign-up cards (services/ai-api/app/packs/registry.py): reviewed types first, then by id
  packs.sort((a, b) => Number(!a.validated) - Number(!b.validated) || (a.id < b.id ? -1 : 1));
  return { packs };
}

export const render = (bundle) => `${JSON.stringify(bundle, null, 1)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const want = render(buildSitePacks());
  if (process.argv.includes("--check")) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (have !== want) {
      console.error("lib/site/site-packs.generated.json is not what packages/packs gives: run `node apps/web/scripts/site-packs.mjs`");
      process.exit(1);
    }
    console.log("site packs are fresh");
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, want);
    console.log(`wrote ${path.relative(process.cwd(), OUT)} (${want.length} bytes)`);
  }
}
