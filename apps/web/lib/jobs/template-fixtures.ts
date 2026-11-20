import autoDealer from "./template-data/auto_dealer.json";
import clinic from "./template-data/clinic.json";
import coaching from "./template-data/coaching.json";
import education from "./template-data/education.json";
import realEstate from "./template-data/real_estate.json";
import textiles from "./template-data/textiles.json";
import wholesale from "./template-data/wholesale_b2b.json";

import { personaOf } from "./sample-fixtures";
import type { SampleType } from "@/lib/screens/preview";

/**
 * THE FIXTURES of the New job sheet (JOBS=mock): the REAL content of seven packs (copies of `packages/packs/<pack>/jobs.json` on main: textiles, clinic, coaching, real_estate, wholesale_b2b, education, auto_dealer; every word is C1's draft) wrapped in the shape the sheet's
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

/** `extra`: only a sample business of the staging picker lists it among the other ideas (the default mock of the saree shop keeps its four, so its screens stay as they were). */
const PACKS: readonly { pack: string; file: Wire; name: Wire; item: Wire; extra?: true }[] = [
  { pack: "textiles", file: textiles, name: t("saree shops", "చీరల షాపులు"), item: t("Kanchipuram silk sarees", "కంచి పట్టు చీరలు") }, // pack-id-ok: the mock copies the real packs
  { pack: "clinic", file: clinic, name: t("clinics", "క్లినిక్‌లు"), item: t("a general check-up", "జనరల్ చెకప్") }, // pack-id-ok: the mock copies the real packs
  { pack: "coaching", file: coaching, name: t("coaching centres", "కోచింగ్ సెంటర్లు"), item: t("the NEET course", "NEET కోర్సు") }, // pack-id-ok: the mock copies the real packs
  { pack: "real_estate", file: realEstate, name: t("real estate", "రియల్ ఎస్టేట్"), item: t("the garden-view flat", "గార్డెన్ వ్యూ ఫ్లాట్") }, // pack-id-ok: the mock copies the real packs
  { pack: "wholesale_b2b", file: wholesale, name: t("wholesalers", "హోల్‌సేల్ వ్యాపారులు"), item: t("cotton fabric rolls", "కాటన్ ఫ్యాబ్రిక్ రోల్స్") }, // pack-id-ok: the mock copies the real packs
  { pack: "education", file: education, name: t("schools", "స్కూళ్ళు"), item: t("Class 10 admission", "క్లాస్ 10 అడ్మిషన్"), extra: true }, // pack-id-ok: the mock copies the real packs
  { pack: "auto_dealer", file: autoDealer, name: t("car showrooms", "కార్ షోరూమ్‌లు"), item: t("the SUV", "SUV"), extra: true }, // pack-id-ok: the mock copies the real packs
];

/** `GET /jobs/templates` for the demo shop (a saree shop), or for a SAMPLE business of the staging picker (`type`: its pack, its sample item): its own templates and the other business types'. */
export function wireNewJobSheet(own = "textiles", type: SampleType | null = null): Wire { // pack-id-ok: the mock copies the real packs
  const persona = personaOf(type);
  const mine = PACKS.find((p) => p.pack === (type ? persona.pack : own)) ?? PACKS[0];
  return {
    business_type: { pack: mine.pack, name: type ? t(persona.name.en, persona.name.te) : mine.name },
    sample: { item: type ? t(persona.item.en, persona.item.te) : mine.item },
    own: withFit(mine.file),
    others: PACKS.filter((p) => p.pack !== mine.pack && (type !== null || !p.extra)).map((p) => ({ pack: p.pack, name: p.name, jobs: withFit(p.file) })),
  };
}

/** `GET /jobs/festivals` in the mock: ONE made-up festival two weeks from `now` (the sample business's own, for the staging picker), so the Today suggestion can be seen on any day. The real calendar (dated, per region) is C1's data. */
export function wireFestivals(now: Date, type: SampleType | null = null): Wire {
  const date = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const f = personaOf(type).festival;
  return { items: [{ season: f.season, name: t(f.en, f.te), date }] };
}
