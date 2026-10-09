import { ArrowRight, Bot, CircleCheck, Inbox, Package, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatINR } from "@/design/format";

import { pageH1 } from "../ui";
import type { NeedsYouItem, T, TodayData } from "./types";

const card = "rounded-xl border border-line bg-surface shadow-[var(--v2-shadow)]";
const pill = "inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold";
const KIND: Record<NeedsYouItem["kind"], { badge: string; kind: string; step: string; tone: string }> = {
  quote_approval: { badge: "today.state.draft", kind: "today.kind.quote", step: "today.step.quote", tone: "border-edge bg-surface text-ink" },
  followup_due: { badge: "today.state.draft", kind: "today.kind.followup", step: "today.step.followup", tone: "border-edge bg-surface text-ink" },
  order_money_held: { badge: "today.needsYou", kind: "today.kind.order", step: "today.step.order", tone: "border-amber-text bg-amber-bg text-amber-text" },
};

/** "3h", "28m", "2d": how long ago (short, no words: the same in every language). */
export function ago(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function NotYet({ t }: { t: T }) {
  return <p className="text-sm text-muted">{t("frame.notyet")}</p>;
}

function Stat({ icon, label, value, hint, href, t, amber = false }: { icon: ReactNode; label: string; value: string | null; hint: string; href: string; t: T; amber?: boolean }) {
  return (
    <Link href={href} className={`group flex min-h-14 items-center justify-between gap-3 px-4 py-2 sm:block sm:p-4 ${card} transition-[border-color] duration-150 hover:border-edge active:bg-surface-2`}>
      <span className="flex min-w-0 items-center justify-between gap-2 text-sm font-medium text-muted">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 ${amber ? "text-amber-text" : "text-brand-text"}`}>{icon}</span>
          <span className="min-w-0 break-words">{label}</span>
        </span>
        <ArrowRight className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
      </span>
      {value === null ? (
        <span className="shrink-0 text-sm text-muted sm:mt-2 sm:block">{t("frame.notyet")}</span>
      ) : (
        <>
          <span className="shrink-0 font-display text-2xl font-bold leading-none tabular-nums sm:mt-2 sm:block sm:text-3xl">{value}</span>
          <span className="mt-2 hidden text-sm text-muted sm:block">{hint}</span>
        </>
      )}
    </Link>
  );
}

/** One thing that needs the person: the state and the kind, who and where, which agent and how long ago, what it is, the amount, ONE main button (it goes to the page that decides: nothing is approved or sent from here) and "Open". */
function Decision({ item, primary, t }: { item: NeedsYouItem; primary: boolean; t: T }) {
  const k = KIND[item.kind];
  const facts: [string, string][] = [[t("today.fact.customer"), item.customer]];
  if (item.city) facts.push([t("today.fact.city"), item.city]);
  if (item.amount_paise !== null) facts.push([t("today.fact.amount"), formatINR(item.amount_paise / 100, { decimals: 2 })]);
  facts.push([t("today.fact.when"), ago(item.at)]);
  return (
    <article aria-labelledby={`needs-${item.id}`} className={`${card} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${pill} ${k.tone}`}>{t(k.badge)}</span>
        <span className="text-sm font-medium text-muted">{t(k.kind)}</span>
      </div>
      <h3 id={`needs-${item.id}`} className="mt-3 text-xl font-semibold leading-snug">
        {item.customer}
        {item.city ? `, ${item.city}` : ""}
      </h3>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <Bot className="size-4" aria-hidden="true" />
        {t(`agent.${item.agent}`)} · {ago(item.at)}
      </p>
      <p className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.summary}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-surface-2 p-3 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="break-words font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Link href={item.href} className={`inline-flex min-h-12 items-center gap-2 rounded-lg border px-5 text-base font-semibold ${primary ? "border-brand-edge bg-brand text-on-brand hover:brightness-95" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}>
          {t(k.step)}
        </Link>
        <Link href={item.href} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-brand-text hover:underline">
          {t("common.open")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted">{t("today.hint.nothingSent")}</p>
    </article>
  );
}

/**
 * The Today screen, as the design-lab app draws it: the greeting and how many things wait, three cards (waiting for you, customer money held, orders in progress), "Needs you" (one
 * card per item, the first one's button in the main colour), "Your team right now" (the agents) and "Recently recorded". It only draws what `data` holds: a null part says "Not available
 * yet"; a helper that is `not_available` (not built) says so on its row. `name` null = the person has no display name on record (the greeting is then the plain greeting).
 */
export function TodayView({ data, name, hour, base, t }: { data: TodayData; name: string | null; hour: number; base: string; t: T }) {
  const { cards, needs_you: needs, recent, team } = data;
  const greet = t(hour < 12 ? "today.greeting.morning" : hour < 17 ? "today.greeting.afternoon" : "today.greeting.evening");
  const waiting = cards.waiting;
  const sub = waiting === null ? null : waiting === 0 ? t("today.sub.none") : waiting === 1 ? t("today.sub.one") : t("today.sub.other", { n: waiting });
  return (
    <div data-screen="today">
      <h1 className={pageH1}>{name ? `${greet}, ${name}` : greet}</h1>
      {sub ? <p className="text-base text-muted">{sub}</p> : null}
      <div className="mb-8 mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
        <Stat t={t} icon={<Inbox className="size-5" aria-hidden="true" />} label={t("frame.waiting")} value={waiting === null ? null : String(waiting)} hint={t("today.stat.waitingHint")} href="#needs-you" />
        <Stat t={t} amber icon={<Wallet className="size-5" aria-hidden="true" />} label={t("today.stat.held")} value={cards.money_held_paise === null ? null : formatINR(cards.money_held_paise / 100, { decimals: 2 })} hint={t("today.stat.heldHint")} href={`${base}/orders`} />
        <Stat t={t} icon={<Package className="size-5" aria-hidden="true" />} label={t("today.stat.open")} value={cards.orders_open === null ? null : String(cards.orders_open)} hint={t("today.stat.openHint")} href={`${base}/orders`} />
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <section id="needs-you" aria-labelledby="needs-you-heading" className="scroll-mt-24 space-y-4 lg:col-span-8">
          <h2 id="needs-you-heading" className="text-2xl font-semibold">
            {t("today.needsYou")}
          </h2>
          {needs === null ? (
            <div className={`${card} p-4`}>
              <NotYet t={t} />
            </div>
          ) : needs.length === 0 ? (
            <div className={`${card} flex items-center gap-3 p-4`}>
              <CircleCheck className="size-6 shrink-0 text-green-text" aria-hidden="true" />
              <p className="font-medium">{t("today.sub.none")}</p>
            </div>
          ) : (
            needs.map((item, i) => <Decision key={`${item.kind}-${item.id}`} item={item} primary={i === 0} t={t} />)
          )}
        </section>
        <aside className="space-y-6 lg:col-span-4">
          <section aria-labelledby="team-heading" className={`${card} p-4`}>
            <h2 id="team-heading" className="mb-3 text-xl font-semibold">
              {t("today.team")}
            </h2>
            {team === null ? (
              <NotYet t={t} />
            ) : (
              <ul className="divide-y divide-line">
                {team.map((a) => (
                  <li key={a.agent} className="flex min-h-14 flex-col justify-center gap-0.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t(`agent.${a.agent}`)}</span>
                      <span className={`${pill} ${a.state === "working" ? "border-brand-edge bg-brand-bg text-brand-text" : "border-line bg-surface-2 text-muted"}`}>{a.state === "working" ? t("office.working") : a.state === "idle" ? t("office.idle") : t("frame.notyet")}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted">{a.last_event ? `${a.last_event.text} · ${ago(a.last_event.at)}` : a.job}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`${base}/office`} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text hover:underline">
              {t("nav.item.office")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </section>
          <section aria-labelledby="recent-heading" className={`${card} p-4`}>
            <h2 id="recent-heading" className="mb-3 text-xl font-semibold">
              {t("today.recent")}
            </h2>
            {recent === null ? (
              <NotYet t={t} />
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((r, i) => (
                  <li key={`${r.order_ref}-${i}`}>
                    <Link href={r.href} className="flex min-h-14 flex-col justify-center rounded-md py-2 hover:bg-surface-2">
                      <span className="font-medium">
                        {r.order_ref} · {r.customer}
                      </span>
                      <span className="text-sm text-muted">
                        {ago(r.at)} · {r.text}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
