import Link from "next/link";

import { COLOURS, FABRICS, OCCASIONS, PRICE_BANDS, type ItemSummary } from "@/lib/api/catalogue";

import { AgentMark } from "../mark/AgentMark";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, field, primary, secondary } from "../visits/styles";
import { FreshPhotos } from "./FreshPhotos";
import { ItemCard, vocab } from "./ItemCard";
import { BAND_WORDS, STOCK_CHOICES, activeFilters, hrefFor, isFiltered, soonestExpiry, toggled, type CatalogueQuery } from "./catalogue-logic";

export type CatalogueViewProps = {
  /** The "?" tip of the screen (job BT): drawn under the heading. */
  help?: React.ReactNode;
  base: string;
  words: TodayWords;
  role: Role;
  query: CatalogueQuery;
  /** null = the catalogue could not be read. */
  items: readonly ItemSummary[] | null;
  /** More items exist: the API's cursor for the link (also null when the page has read as many as it will). */
  more: string | null;
  /** The customer a saree is being chosen for (the lead page's "Send a saree"), kept on every link. */
  lead: { leadId: string; label: string } | null;
};

const chipClass = (on: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-base leading-tight ${on ? "border-brand-edge bg-brand-bg font-semibold text-brand-text" : "border-edge font-medium text-ink hover:bg-surface-2"}`;

function Chip({ href, on, children, words }: { href: string; on: boolean; children: React.ReactNode; words: TodayWords }) {
  return (
    <Link href={href} data-chip={on ? "on" : "off"} className={chipClass(on)}>
      {children}
      {on ? <span className="sr-only"> ({say(words, "catalogue.chip.on")})</span> : null}
    </Link>
  );
}

/** The catalogue page (job BC): search, filters as chips, the photo grid. It only draws what the server read; a catalogue that could not be read says so in its place. */
export function CatalogueView({ base, words, role, query, items, more, lead, help }: CatalogueViewProps) {
  const admin = role === "owner" || role === "admin";
  const leadId = lead?.leadId ?? null;
  const link = (q: CatalogueQuery) => hrefFor(base, q, { lead: leadId });
  const filters = activeFilters(query);
  // the first-saree call to action stands alone: the header button would only say the same thing twice
  const firstSaree = items !== null && items.length === 0 && !isFiltered(query);
  const group = (id: string, titleKey: string, chips: React.ReactNode) => (
    <fieldset key={id} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold">{say(words, titleKey)}</legend>
      <div className="flex flex-wrap gap-2">{chips}</div>
    </fieldset>
  );
  return (
    <FreshPhotos seconds={items ? soonestExpiry(items) : null}>
      <div data-screen="catalogue" className="flex flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.sarees")}</h1>
            <p className="text-base text-muted">{say(words, "catalogue.sub")}</p>
          </div>
          {admin && !firstSaree ? (
            <Link href={`${base}/catalogue/new`} className={primary}>
              {say(words, "catalogue.add")}
            </Link>
          ) : null}
        </header>
        {help}

        {lead ? (
          <p data-note="lead" className="rounded-2xl bg-surface-2 px-4 py-3 text-base">
            {say(words, "catalogue.picking", { who: lead.label })}
          </p>
        ) : null}

        <form method="get" action={`${base}/catalogue`} role="search" className="flex flex-wrap items-end gap-3">
          {query.fabric ? <input type="hidden" name="fabric" value={query.fabric} /> : null}
          {query.colours.length ? <input type="hidden" name="colour" value={query.colours.join(",")} /> : null}
          {query.occasions.length ? <input type="hidden" name="occasion" value={query.occasions.join(",")} /> : null}
          {query.bands.length ? <input type="hidden" name="band" value={query.bands.join(",")} /> : null}
          {query.stock ? <input type="hidden" name="stock" value={query.stock} /> : null}
          {leadId ? <input type="hidden" name="lead" value={leadId} /> : null}
          <div className="min-w-48 flex-1">
            <label htmlFor="catalogue-q" className="mb-1.5 block text-sm font-semibold">
              {say(words, "catalogue.search.label")}
            </label>
            <input id="catalogue-q" name="q" type="search" maxLength={100} defaultValue={query.q} placeholder={say(words, "catalogue.search.placeholder")} className={field} />
          </div>
          <button type="submit" className={secondary}>
            {say(words, "catalogue.search.go")}
          </button>
        </form>

        <details open={filters > 0} className="rounded-2xl border border-line bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{filters > 0 ? say(words, "catalogue.filters.count", { n: filters }) : say(words, "catalogue.filters")}</summary>
          <div className="flex flex-col gap-4 border-t border-line p-4">
            {group(
              "stock",
              "catalogue.filter.stock",
              STOCK_CHOICES.map((s) => (
                <Chip key={s} words={words} on={query.stock === s} href={link(toggled(query, "stock", s))}>
                  {say(words, `catalogue.stock.${s}`)}
                </Chip>
              )),
            )}
            {group(
              "fabric",
              "catalogue.filter.fabric",
              FABRICS.map((f) => (
                <Chip key={f} words={words} on={query.fabric === f} href={link(toggled(query, "fabric", f))}>
                  {vocab(words, "fabric", f, f)}
                </Chip>
              )),
            )}
            {group(
              "colour",
              "catalogue.filter.colour",
              COLOURS.map((c) => (
                <Chip key={c} words={words} on={query.colours.includes(c)} href={link(toggled(query, "colour", c))}>
                  {vocab(words, "colour", c, c)}
                </Chip>
              )),
            )}
            {group(
              "occasion",
              "catalogue.filter.occasion",
              OCCASIONS.map((o) => (
                <Chip key={o} words={words} on={query.occasions.includes(o)} href={link(toggled(query, "occasion", o))}>
                  {vocab(words, "occasion", o, o)}
                </Chip>
              )),
            )}
            {group(
              "band",
              "catalogue.filter.band",
              PRICE_BANDS.map((b) => (
                <Chip key={b} words={words} on={query.bands.includes(b)} href={link(toggled(query, "band", b))}>
                  {BAND_WORDS[b]}
                </Chip>
              )),
            )}
          </div>
        </details>
        {isFiltered(query) ? (
          <p>
            <Link href={hrefFor(base, { q: "", fabric: null, colours: [], occasions: [], bands: [], stock: null }, { lead: leadId })} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">
              {say(words, "catalogue.clear")}
            </Link>
          </p>
        ) : null}

        {items === null ? (
          <div role="alert" className={`${card} flex-row items-center`} data-state="error">
            <AgentMark px={56} mood={"resting"} className="size-14" />
            <div>
              <p className="font-semibold">{say(words, "frame.notyet")}</p>
              <p className="text-sm text-muted">{say(words, "catalogue.error.body")}</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          isFiltered(query) ? (
            <div className={`${card} flex-row items-center`} data-state="nomatch">
              <AgentMark px={56} mood={"idle"} className="size-14" />
              <div>
                <p className="font-semibold">{say(words, "catalogue.nomatch.title")}</p>
                <p className="text-sm text-muted">{say(words, "catalogue.nomatch.body")}</p>
              </div>
            </div>
          ) : (
            <div className={`${card} items-start`} data-state="empty">
              <div className="flex items-center gap-3">
                <AgentMark px={64} mood={"idle"} className="size-16" />
                <h2 className="font-display text-2xl font-bold leading-tight">{say(words, "catalogue.empty.title")}</h2>
              </div>
              <p className="text-base text-muted">{say(words, admin ? "catalogue.empty.admin" : "catalogue.empty.other")}</p>
              {admin ? (
                <Link href={`${base}/catalogue/new`} className={primary}>
                  {say(words, "catalogue.add")}
                </Link>
              ) : null}
            </div>
          )
        ) : (
          <>
            <p className="text-sm text-muted" aria-live="polite">
              {more ? say(words, "catalogue.results.more", { n: items.length }) : say(words, items.length === 1 ? "catalogue.results.one" : "catalogue.results.other", { n: items.length })}
            </p>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" data-grid="items">
              {items.map((item, i) => (
                <ItemCard key={item.id} item={item} words={words} eager={i < 2} href={`${base}/catalogue/${item.id}${leadId ? `?lead=${leadId}` : ""}`} />
              ))}
            </ul>
            {more ? (
              <p>
                <Link href={hrefFor(base, query, { lead: leadId, after: more })} className={secondary}>
                  {say(words, "catalogue.more")}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </div>
    </FreshPhotos>
  );
}
