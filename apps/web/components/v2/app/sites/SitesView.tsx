import Link from "next/link";

import type { SiteOut } from "@contracts";

import { AgentMark } from "../mark/AgentMark";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { badge, card, okLine, primary, secondary } from "../visits/styles";

export type SitesViewProps = {
  base: string;
  words: TodayWords;
  role: Role;
  /** null = the sites could not be read. */
  sites: readonly SiteOut[] | null;
  /** The customers' names by id (a customer that could not be read is simply missing). */
  names: Readonly<Record<string, string>>;
  more: string | null;
  saved: boolean;
  help?: React.ReactNode;
};

const mapLink = (s: SiteOut) => (s.map_lat !== null && s.map_lng !== null ? `https://www.google.com/maps?q=${s.map_lat},${s.map_lng}` : null);

/** The delivery sites of the customers, grouped by customer (job CO): the place, the distance, what a truck needs to know and a link to the map pin. Owner, Admin and Sales add and change; everyone reads. */
export function SitesView({ base, words, role, sites, names, more, saved, help }: SitesViewProps) {
  const writer = role !== "viewer";
  const groups = new Map<string, SiteOut[]>();
  for (const s of sites ?? []) groups.set(s.company_id, [...(groups.get(s.company_id) ?? []), s]);
  return (
    <div data-screen="sites" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.sites")}</h1>
          <p className="text-base text-muted">{say(words, "site.sub")}</p>
        </div>
        {writer && sites !== null && sites.length > 0 ? (
          <Link href={`${base}/sites/new`} className={primary}>
            {say(words, "site.add")}
          </Link>
        ) : null}
      </header>
      {help}
      {saved ? <p role="status" className={okLine}>{say(words, "site.saved")}</p> : null}
      {sites === null ? (
        <div role="alert" className={`${card} flex-row items-center`} data-state="error">
          <AgentMark px={56} mood="resting" className="size-14" />
          <div>
            <p className="font-semibold">{say(words, "frame.notyet")}</p>
            <p className="text-sm text-muted">{say(words, "site.error")}</p>
          </div>
        </div>
      ) : sites.length === 0 ? (
        <div className={`${card} items-start`} data-state="empty">
          <div className="flex items-center gap-3">
            <AgentMark px={64} mood="idle" className="size-16" />
            <h2 className="font-display text-2xl font-bold leading-tight">{say(words, "site.empty.title")}</h2>
          </div>
          <p className="text-base text-muted">{say(words, "site.empty.body")}</p>
          {writer ? <Link href={`${base}/sites/new`} className={primary}>{say(words, "site.add")}</Link> : null}
        </div>
      ) : (
        <>
          {[...groups.entries()].map(([companyId, list]) => (
            <section key={companyId} aria-labelledby={`sites-${companyId}`} className="flex flex-col gap-2" data-company={companyId}>
              <h2 id={`sites-${companyId}`} className="font-display text-xl font-bold [overflow-wrap:anywhere]">{names[companyId] ?? say(words, "site.customer.unknown")}</h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((s) => (
                  <li key={s.id} className={`${card} ${s.active ? "" : "border-dashed opacity-80"}`} data-site={s.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{s.name}</p>
                      {s.active ? null : <span className={`${badge} border border-edge bg-surface-2`}>{say(words, "site.inactive")}</span>}
                    </div>
                    <p className="text-base text-muted [overflow-wrap:anywhere]">{[s.address_line, s.city, s.pin].filter(Boolean).join(", ") || say(words, "site.noaddress")}</p>
                    <p className="flex flex-wrap gap-1.5 text-sm">
                      {s.distance_km !== null ? <span className={`${badge} bg-info-bg text-info-text`}>{say(words, "site.km", { n: s.distance_km })}</span> : null}
                      {s.night_delivery ? <span className={`${badge} bg-surface-2`}>{say(words, "site.night")}</span> : null}
                      {s.unloading_help ? <span className={`${badge} bg-surface-2`}>{say(words, "site.unload")}</span> : null}
                      {s.lane_width_ft !== null ? <span className={`${badge} bg-surface-2`}>{say(words, "site.lane", { n: s.lane_width_ft })}</span> : null}
                    </p>
                    {s.access_notes ? <p className="text-sm [overflow-wrap:anywhere]">{s.access_notes}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      {mapLink(s) ? (
                        <a href={mapLink(s) as string} target="_blank" rel="noopener noreferrer" className={secondary}>{say(words, "site.map.open")}</a>
                      ) : null}
                      <Link href={`${base}/sites/${s.id}`} className={secondary}>{writer ? say(words, "site.edit") : say(words, "site.view")}</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more ? <p><Link href={`${base}/sites?after=${encodeURIComponent(more)}`} className={secondary}>{say(words, "mat.products.more")}</Link></p> : null}
        </>
      )}
    </div>
  );
}
