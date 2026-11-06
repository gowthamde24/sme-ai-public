import Link from "next/link";

import type { TimelineItem, TimelineKind } from "@/lib/api/customer-timeline";

/**
 * One page per customer (app v4 part 3, owner 6 Nov 2026; behind APP_V4): the header (the name, the business, the language, where they came from, the status in plain words), ONE timeline of everything that happened with them,
 * newest first, with filter chips (plain links: they work without script), and beside it (on a phone: above it) What they want and What's next, with ONE main button for the next step. Server markup; every word comes from the
 * page (`w`). Nothing is invented: a part with nothing to say says so.
 */
export type CustomerFilter = "all" | "call" | "message" | "quote" | "visit" | "order" | "follow_up";
export const FILTER_KINDS: Record<Exclude<CustomerFilter, "all">, readonly TimelineKind[]> = { call: ["call", "outcome"], message: ["message_in", "message_out", "arrival"], quote: ["quote"], visit: ["visit"], order: ["order"], follow_up: ["follow_up"] };
export type CustomerViewProps = {
  name: string;
  business: string | null;
  language: string | null;
  source: string | null;
  status: string;
  want: readonly { label: string; value: string }[];
  next: { what: string; when: string | null } | null;
  main: { href: string; label: string };
  items: readonly TimelineItem[] | null;
  filter: CustomerFilter;
  filterHref: (f: CustomerFilter) => string;
  olderHref: string | null;
  itemHref: (i: TimelineItem) => string | null;
  when: (iso: string) => string;
  w: Readonly<Record<string, string>>;
};

const KIND_DOT: Record<TimelineKind, string> = { call: "bg-[#ff773c]", outcome: "bg-[#ff773c]", message_in: "bg-sky-500", message_out: "bg-sky-500", arrival: "bg-sky-500", quote: "bg-violet-500", visit: "bg-emerald-500", order: "bg-emerald-600", follow_up: "bg-amber-500" };

export function CustomerView(p: CustomerViewProps) {
  const w = p.w;
  const f = p.filter;
  const shown = p.items === null ? null : f === "all" ? p.items : p.items.filter((i) => FILTER_KINDS[f].includes(i.kind));
  const filters: CustomerFilter[] = ["all", "call", "message", "quote", "visit", "order", "follow_up"];
  const side = (
    <aside className="flex flex-col gap-4" data-part="customer-side">
      <section aria-labelledby="cust-want" className="rounded-[22px] border border-line bg-surface p-4">
        <h2 id="cust-want" className="m-0 font-display text-lg font-bold">
          {w["cust.v4.want.title"]}
        </h2>
        {p.want.length ? (
          <dl className="m-0 mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            {p.want.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-muted">{r.label}</dt>
                <dd className="m-0 font-semibold text-ink [overflow-wrap:anywhere]">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 mt-2 text-sm text-muted">{w["cust.v4.want.none"]}</p>
        )}
      </section>
      <section aria-labelledby="cust-next" className="rounded-[22px] border border-line bg-surface p-4">
        <h2 id="cust-next" className="m-0 font-display text-lg font-bold">
          {w["cust.v4.next.title"]}
        </h2>
        {p.next ? (
          <p className="m-0 mt-2 text-sm">
            <span className="font-semibold text-ink">{p.next.what}</span>
            {p.next.when ? <span className="text-muted"> · {p.next.when}</span> : null}
          </p>
        ) : (
          <p className="m-0 mt-2 text-sm text-muted">{w["cust.v4.next.none"]}</p>
        )}
        <Link href={p.main.href} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#ff773c] px-5 font-extrabold text-[#1e1e24]" data-part="customer-main">
          {p.main.label}
        </Link>
      </section>
    </aside>
  );
  return (
    <div data-screen="customer" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{p.name}</h1>
        <p className="m-0 flex flex-wrap gap-y-1 text-sm text-muted">
          {[p.business, p.language, p.source ? (w["cust.v4.from"] ?? "{source}").replace("{source}", p.source) : null]
            .filter((x): x is string => !!x)
            .map((x, i) => (
              <span key={x}>
                {i > 0 ? <span aria-hidden="true">&nbsp;·&nbsp;</span> : null}
                {x}
              </span>
            ))}
        </p>
        <p className="m-0 mt-1 inline-flex self-start rounded-full bg-brand-bg px-3 py-1 text-sm font-bold text-brand-text" data-part="customer-status">
          {p.status}
        </p>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* on a phone What they want and What's next come first; beside the timeline from a wide screen */}
        <div className="lg:order-2">{side}</div>
        <section aria-labelledby="cust-timeline" className="flex min-w-0 flex-col gap-3 lg:order-1">
          <h2 id="cust-timeline" className="sr-only">
            {w["cust.v4.timeline"]}
          </h2>
          <nav aria-label={w["cust.v4.filters"]} className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filters.map((f) => (
              <Link key={f} href={p.filterHref(f)} aria-current={p.filter === f ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-bold ${p.filter === f ? "bg-ink text-bg" : "bg-surface text-muted shadow-[inset_0_0_0_1.5px_var(--v2-border)] hover:text-ink"}`} data-filter={f}>
                {w[`cust.v4.filter.${f}`]}
              </Link>
            ))}
          </nav>
          {shown === null ? (
            <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{w["cust.v4.unreadable"]}</p>
          ) : shown.length === 0 ? (
            <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{w["cust.v4.empty"]}</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0" data-part="customer-timeline">
              {shown.map((i) => {
                const href = p.itemHref(i);
                const body = (
                  <>
                    <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${KIND_DOT[i.kind]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-xs font-extrabold uppercase tracking-wide text-muted">{w[`cust.v4.kind.${i.kind}`]}</span>
                        <time dateTime={i.at} className="text-xs tabular-nums text-muted">
                          {p.when(i.at)}
                        </time>
                      </span>
                      <span className="mt-0.5 block text-sm text-ink [overflow-wrap:anywhere]">{i.text}</span>
                    </span>
                  </>
                );
                return (
                  <li key={`${i.kind}-${i.target.id}-${i.at}`} data-kind={i.kind}>
                    {href ? (
                      <Link href={href} className="flex gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-brand-edge">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex gap-3 rounded-2xl border border-line bg-surface p-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {p.olderHref ? (
            <Link href={p.olderHref} className="self-start text-sm font-semibold text-brand-text underline underline-offset-4">
              {w["cust.v4.older"]}
            </Link>
          ) : null}
        </section>
      </div>
    </div>
  );
}
