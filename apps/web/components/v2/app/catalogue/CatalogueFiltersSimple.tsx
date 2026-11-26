import { cardBox } from "../Card";
import Link from "next/link";

import { COLOURS, FABRICS, OCCASIONS, PRICE_BANDS } from "@/lib/api/catalogue";

import { filtersOpen } from "@/lib/screens/flag";
import { LinkSentence } from "../jobs/pages/LazyLinkSentence";
import { EffectLine, MoreBox, pgCard } from "../jobs/pages/parts";
import { say, type TodayWords } from "../today/today-words";
import { secondary } from "../visits/styles";
import { vocab } from "./ItemCard";
import { bandText, STOCK_CHOICES, hrefFor, toggled, type CatalogueQuery } from "./catalogue-logic";

const plainChip = (on: boolean) => `inline-flex min-h-11 items-center gap-1.5 rounded-md border px-4 text-[15px] leading-tight text-ink ${on ? "border-ink font-semibold" : "border-line font-medium hover:bg-surface-2"}`;
const chipClass = (on: boolean) => `inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 text-[15px] leading-tight ${on ? "bg-brand-bg font-semibold text-brand-text" : "bg-surface-2 font-medium text-ink hover:bg-line"}`;

/**
 * The search and the filters of the catalogue under JOBS (the simplicity pass): ONE card with "Show [all sarees], made of [any fabric]." (the stock and the fabric, each a choice inside the sentence), the search box, and the one line that says what is shown now.
 * The colour, the occasion and the price are under "More choices" (the same chips as before, each a link). Every choice goes to the SAME address as the old chips (`hrefFor` / `toggled`, the customer being chosen for is kept), so nothing was removed.
 */
export function CatalogueFiltersSimple({ base, words, query, leadId, effect }: { base: string; words: TodayWords; query: CatalogueQuery; leadId: string | null; /** what is on the screen now, in words (null while there is nothing to count) */ effect: string | null }) {
  const plain = filtersOpen();
  const link = (q: CatalogueQuery) => hrefFor(base, q, { lead: leadId });
  const moreOn = query.colours.length > 0 || query.occasions.length > 0 || query.bands.length > 0;
  const group = (id: string, titleKey: string, chips: React.ReactNode) => (
    <fieldset key={id} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold">{say(words, titleKey)}</legend>
      <div className="flex flex-wrap gap-2">{chips}</div>
    </fieldset>
  );
  const chip = (on: boolean, href: string, text: string) => (
    <Link key={text} href={href} data-chip={on ? "on" : "off"} className={plain ? plainChip(on) : chipClass(on)}>
      {text}
      {on ? <span className="sr-only"> ({say(words, "catalogue.chip.on")})</span> : null}
    </Link>
  );
  const groups = (
    <>
      {group("colour", "catalogue.filter.colour", COLOURS.map((c) => chip(query.colours.includes(c), link(toggled(query, "colour", c)), vocab(words, "colour", c, c))))}
      {group("occasion", "catalogue.filter.occasion", OCCASIONS.map((o) => chip(query.occasions.includes(o), link(toggled(query, "occasion", o)), vocab(words, "occasion", o, o))))}
      {group("band", "catalogue.filter.band", PRICE_BANDS.map((b) => chip(query.bands.includes(b), link(toggled(query, "band", b)), bandText(words, b))))}
    </>
  );
  return (
    <section data-part="catalogue-filters" data-simple="" className={plain ? `${cardBox} flex flex-col gap-3` : `${pgCard} flex flex-col gap-3`}>
      <LinkSentence
        plain={plain}
        line="catalogue"
        template={say(words, "jobs.pg.cat.line")}
        choices={{
          stock: { label: say(words, "catalogue.filter.stock"), value: query.stock ?? "all", options: [{ value: "all", text: say(words, "jobs.pg.cat.st.all"), href: link({ ...query, stock: null }) }, ...STOCK_CHOICES.map((s) => ({ value: s, text: say(words, `jobs.pg.cat.st.${s}`), href: link({ ...query, stock: s }) }))] },
          fabric: { label: say(words, "catalogue.filter.fabric"), value: query.fabric ?? "any", options: [{ value: "any", text: say(words, "jobs.pg.cat.fab.any"), href: link({ ...query, fabric: null }) }, ...FABRICS.map((f) => ({ value: f, text: vocab(words, "fabric", f, f), href: link({ ...query, fabric: f }) }))] },
          ...(plain
            ? {
                colour: { label: say(words, "catalogue.filter.colour"), value: query.colours[0] ?? "any", options: [{ value: "any", text: say(words, "catalogue.f.any_colour"), href: link({ ...query, colours: [] }) }, ...COLOURS.map((c) => ({ value: c, text: vocab(words, "colour", c, c), href: link({ ...query, colours: [c] }) }))] },
                occasion: { label: say(words, "catalogue.filter.occasion"), value: query.occasions[0] ?? "any", options: [{ value: "any", text: say(words, "catalogue.f.any_occasion"), href: link({ ...query, occasions: [] }) }, ...OCCASIONS.map((o) => ({ value: o, text: vocab(words, "occasion", o, o), href: link({ ...query, occasions: [o] }) }))] },
                price: { label: say(words, "catalogue.filter.band"), value: query.bands[0] ?? "any", options: [{ value: "any", text: say(words, "catalogue.f.any_price"), href: link({ ...query, bands: [] }) }, ...PRICE_BANDS.map((b) => ({ value: b, text: bandText(words, b), href: link({ ...query, bands: [b] }) }))] },
              }
            : {}),
        }}
      />
      <form method="get" action={`${base}/catalogue`} role="search" className="flex flex-wrap items-center gap-2">
        {query.fabric ? <input type="hidden" name="fabric" value={query.fabric} /> : null}
        {query.colours.length ? <input type="hidden" name="colour" value={query.colours.join(",")} /> : null}
        {query.occasions.length ? <input type="hidden" name="occasion" value={query.occasions.join(",")} /> : null}
        {query.bands.length ? <input type="hidden" name="band" value={query.bands.join(",")} /> : null}
        {query.stock ? <input type="hidden" name="stock" value={query.stock} /> : null}
        {leadId ? <input type="hidden" name="lead" value={leadId} /> : null}
        <label className="min-w-48 flex-1 md:max-w-md">
          <span className="sr-only">{say(words, "catalogue.search.label")}</span>
          <input id="catalogue-q" name="q" type="search" maxLength={100} defaultValue={query.q} placeholder={say(words, "catalogue.search.placeholder")} className="write-ctl min-h-11 w-full rounded-md border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-muted focus:border-brand-edge" />
        </label>
        <button type="submit" className={secondary}>
          {say(words, "catalogue.search.go")}
        </button>
      </form>
      {effect ? (plain ? <p data-part="catalogue-effect" className="m-0 text-[14px] text-muted">{effect}</p> : <EffectLine part="catalogue-effect" text={effect} />) : null}
      {plain ? null : (
      <MoreBox title={say(words, "jobs.pg.more")} sub={say(words, "jobs.pg.cat.more.sub")} open={moreOn}>
        {groups}
      </MoreBox>
      )}
    </section>
  );
}
