import Link from "next/link";

import type { Place } from "@/lib/map/places";

type W = Readonly<Record<string, string>>;
export type CustomerMapProps = { places: readonly Place[]; customers: number; withoutPlace: number; sites: number; w: W; /** a part that could not be read says so, never "no customers" */ unread: { customers: boolean; sites: boolean } };

/**
 * Customers > Map (app v4 part 5): where the customers are, as a list of real places, grouped by city, the biggest first. Each customer links to their page. Only places that were given are shown (no map tiles, no looked-up addresses:
 * the owner's rule), and the page says so. A source that could not be read is said, not drawn as empty.
 */
export function CustomerMap({ places, customers, withoutPlace, sites, w, unread }: CustomerMapProps) {
  const count = (key: string, n: number) => (w[`${key}.${n === 1 ? "one" : "other"}`] ?? "").replace("{n}", n.toLocaleString("en-IN"));
  return (
    <div className="flex flex-col gap-4" data-screen="customer-map">
      <p className="m-0 text-sm text-muted" data-part="map-honest">
        {w["map.honest"]}
      </p>
      {unread.customers || unread.sites ? (
        <p role="alert" className="m-0 rounded-2xl border border-line bg-surface p-3 text-sm text-muted" data-part="map-unread">
          {unread.customers && unread.sites ? w["map.unread.both"] : unread.customers ? w["map.unread.customers"] : w["map.unread.sites"]}
        </p>
      ) : null}
      {places.length === 0 ? (
        <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted" data-part="map-empty">
          {w["map.empty"]}
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0 md:grid-cols-2" data-part="map-places">
          {places.map((p) => (
            <li key={p.key} data-place={p.key}>
              <section aria-labelledby={`pl-${p.key.replace(/[^a-z0-9]+/g, "-")}`} className="flex h-full flex-col gap-2 rounded-[22px] border border-line bg-surface p-4">
                <h2 id={`pl-${p.key.replace(/[^a-z0-9]+/g, "-")}`} className="m-0 flex flex-wrap items-baseline justify-between gap-x-3 font-display text-lg font-bold">
                  <span className="[overflow-wrap:anywhere]">{p.city}</span>
                  <span className="text-sm font-semibold text-muted">{[p.entries.some((e) => e.kind === "customer") ? count("map.t.customers", p.entries.filter((e) => e.kind === "customer").length) : null, p.entries.some((e) => e.kind === "site") ? count("map.t.sites", p.entries.filter((e) => e.kind === "site").length) : null].filter(Boolean).join(" · ")}</span>
                </h2>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {p.entries.map((e) => (
                    <li key={`${e.kind}-${e.id}`} data-entry={e.kind} className="flex flex-col">
                      {e.href ? (
                        <Link href={e.href} className="inline-flex min-h-11 flex-col justify-center font-semibold text-brand-text underline-offset-4 hover:underline">
                          <span className="[overflow-wrap:anywhere]">{e.name}</span>
                          <span className="text-sm font-normal text-muted">{e.line}</span>
                        </Link>
                      ) : (
                        <span className="flex min-h-11 flex-col justify-center">
                          <span className="font-semibold [overflow-wrap:anywhere]">
                            {e.name} <span className="text-xs font-bold text-muted">· {w["map.site"]}</span>
                          </span>
                          <span className="text-sm text-muted [overflow-wrap:anywhere]">{e.line}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-sm text-muted" data-part="map-totals">
        {[count("map.t.customers", customers), sites > 0 ? count("map.t.sites", sites) : null, withoutPlace > 0 ? count("map.t.noplace", withoutPlace) : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
