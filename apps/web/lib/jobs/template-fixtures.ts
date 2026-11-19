import clinic from "./template-data/clinic.json";
import coaching from "./template-data/coaching.json";
import realEstate from "./template-data/real_estate.json";
import textiles from "./template-data/textiles.json";
import wholesale from "./template-data/wholesale_b2b.json";

/**
 * THE FIXTURES of the New job sheet (JOBS=mock): the REAL content of five packs (copies of `packages/packs/<pack>/jobs.json` on main: textiles, clinic, coaching, real_estate, wholesale_b2b; every word is C1's draft) wrapped in the shape the sheet's
 * adapter reads (`lib/api/job-templates.ts`, test: lib/api/job-templates.test.ts parses all of it through the REAL parsers). Only three things are added by the wrapper, each a question for C1 (jobs-templates-web-needs.md): the business type's name
 * (a short noun phrase), what an {item} reads like for that business type, and the `fit` of the three example prospects (the real score comes from the prospects API; the numbers here are placeholders of the mock). Nothing here is sent or stored.
 */
type Wire = Record<string, unknown>;
const t = (en: string, te: string) => ({ en, te });

/** A made-up fit for the example prospects of a Lead Finder template (placeholders: the prospects API gives the real score). */
const FIT = [92, 87, 78] as const;
const withFit = (file: Wire): Wire => ({
  ...file,
  templates: (file.templates as Wire[]).map((tpl) => (Array.isArray(tpl.examples) ? { ...tpl, examples: (tpl.examples as Wire[]).map((e, i) => ({ ...e, fit: FIT[i] ?? null })) } : tpl)),
});

const PACKS: readonly { pack: string; file: Wire; name: Wire; item: Wire }[] = [
  { pack: "textiles", file: textiles, name: t("saree shops", "చీరల షాపులు"), item: t("Kanchipuram silk sarees", "కంచి పట్టు చీరలు") }, // pack-id-ok: the mock copies five real packs
  { pack: "clinic", file: clinic, name: t("clinics", "క్లినిక్‌లు"), item: t("a general check-up", "జనరల్ చెకప్") }, // pack-id-ok: the mock copies five real packs
  { pack: "coaching", file: coaching, name: t("coaching centres", "కోచింగ్ సెంటర్లు"), item: t("the NEET course", "NEET కోర్సు") }, // pack-id-ok: the mock copies five real packs
  { pack: "real_estate", file: realEstate, name: t("real estate", "రియల్ ఎస్టేట్"), item: t("the garden-view flat", "గార్డెన్ వ్యూ ఫ్లాట్") }, // pack-id-ok: the mock copies five real packs
  { pack: "wholesale_b2b", file: wholesale, name: t("wholesalers", "హోల్‌సేల్ వ్యాపారులు"), item: t("cotton fabric rolls", "కాటన్ ఫ్యాబ్రిక్ రోల్స్") }, // pack-id-ok: the mock copies five real packs
];

/** `GET /jobs/templates` for the demo shop (a saree shop): its own templates and the four other business types'. */
export function wireNewJobSheet(own = "textiles"): Wire { // pack-id-ok: the mock copies five real packs
  const mine = PACKS.find((p) => p.pack === own) ?? PACKS[0];
  return {
    business_type: { pack: mine.pack, name: mine.name },
    sample: { item: mine.item },
    own: withFit(mine.file),
    others: PACKS.filter((p) => p.pack !== mine.pack).map((p) => ({ pack: p.pack, name: p.name, jobs: withFit(p.file) })),
  };
}

/** `GET /jobs/festivals` in the mock: ONE made-up festival two weeks from `now`, so the Today suggestion can be seen on any day. The real calendar (dated, per region) is C1's data. */
export function wireFestivals(now: Date): Wire {
  const date = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  return { items: [{ season: "diwali", name: t("Diwali", "దీపావళి"), date }] };
}
