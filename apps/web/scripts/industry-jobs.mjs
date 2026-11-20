// Generates apps/web/lib/site/industry-jobs.generated.json from packages/packs/<pack>/jobs.json.
// Keeping the industry data and 3-job extracts in JSON ensures apps/web never reads packages/packs at
// runtime (Docker copies apps/web only) and keeps pack ids/slugs out of .ts/.tsx files (scripts/packs_check.py).
//   node apps/web/scripts/industry-jobs.mjs
//   node apps/web/scripts/industry-jobs.mjs --check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKS_DIR = path.resolve(HERE, "..", "..", "..", "packages", "packs");
export const OUT = path.resolve(HERE, "..", "lib", "site", "industry-jobs.generated.json");

export const INDUSTRY_CONFIGS = [
  {
    slug: "real-estate",
    pack: "real_estate",
    label: "For real estate",
    headline: "Your AI assistant for real estate.",
    oneLiner: "Calls new property enquiries right away in Telugu, Hindi, Kannada or English and books site visits.",
    metaTitle: "AI Assistant for Real Estate — Stack19",
    metaDescription: "Call back property enquiries fast, answer buyer calls during site visits, and book visits in Telugu, Hindi, Kannada and English.",
  },
  {
    slug: "education",
    pack: "education",
    label: "For education",
    headline: "Your AI assistant for schools and colleges.",
    oneLiner: "Answers parent calls and admission enquiries in Telugu, Hindi, Kannada or English and schedules campus visits.",
    metaTitle: "AI Assistant for Schools & Education — Stack19",
    metaDescription: "Follow up on admission enquiries right away, answer office calls when busy, and book campus visits in four languages.",
  },
  {
    slug: "healthcare",
    pack: "clinic",
    label: "For healthcare",
    headline: "Your AI assistant for clinics and diagnostics.",
    oneLiner: "Handles patient enquiries in Telugu, Hindi, Kannada or English and books appointments even after hours.",
    metaTitle: "AI Assistant for Clinics & Healthcare — Stack19",
    metaDescription: "Answer patient calls, respond to enquiries quickly, and schedule clinic appointments in Telugu, Hindi, Kannada and English.",
  },
  {
    slug: "automotive",
    pack: "auto_dealer",
    label: "For automotive",
    headline: "Your AI assistant for auto dealerships.",
    oneLiner: "Calls back vehicle enquiries in Telugu, Hindi, Kannada or English and books showroom test drives.",
    metaTitle: "AI Assistant for Auto Dealerships — Stack19",
    metaDescription: "Respond to vehicle enquiries quickly, handle showroom calls when teams are busy, and schedule test drives in four languages.",
  },
  {
    slug: "retail",
    pack: "general_business",
    label: "For retail",
    headline: "Your AI assistant for retail stores.",
    oneLiner: "Answers missed customer calls in Telugu, Hindi, Kannada or English and checks back on quiet enquiries.",
    metaTitle: "AI Assistant for Retail Stores — Stack19",
    metaDescription: "Answer store calls when busy, call back customer enquiries quickly, and follow up in Telugu, Hindi, Kannada and English.",
  },
  {
    slug: "wholesale",
    pack: "wholesale_b2b",
    label: "For wholesale",
    headline: "Your AI assistant for wholesale and B2B.",
    oneLiner: "Calls back trade enquiries in Telugu, Hindi, Kannada or English and reminds dealers when to reorder.",
    metaTitle: "AI Assistant for Wholesale & B2B — Stack19",
    metaDescription: "Follow up on business enquiries right away, answer trade calls when busy, and remind dealers to reorder in four languages.",
  },
];

export function buildIndustryJobs(packsDir = PACKS_DIR) {
  const industries = INDUSTRY_CONFIGS.map(({ pack, ...meta }) => {
    const raw = JSON.parse(fs.readFileSync(path.join(packsDir, pack, "jobs.json"), "utf8"));
    const jobs = (raw.templates ?? []).slice(0, 3).map((t) => ({
      id: String(t.id),
      kind: String(t.kind),
      title: String(t.title?.en ?? ""),
      benefit: String(t.benefit?.en ?? ""),
      ask: String(t.ask?.en ?? ""),
    }));
    return { ...meta, jobs };
  });
  return { industries };
}

export const render = (bundle) => `${JSON.stringify(bundle, null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const want = render(buildIndustryJobs());
  if (process.argv.includes("--check")) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (have !== want) {
      console.error("lib/site/industry-jobs.generated.json is stale: run `node apps/web/scripts/industry-jobs.mjs`");
      process.exit(1);
    }
    console.log("industry jobs are fresh");
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, want);
    console.log(`wrote ${path.relative(process.cwd(), OUT)} (${want.length} bytes)`);
  }
}
