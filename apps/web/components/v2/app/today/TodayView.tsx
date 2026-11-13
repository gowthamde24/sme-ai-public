import type { ReactNode } from "react";

import type { PackCard } from "@/lib/packs/pack-cards";
import { formatRupeesShort } from "@/lib/money";


import { LiveNow } from "../live/LazyLiveNow";
import { CommandBar } from "./CommandBar";
import { SetupSlot } from "../setup/SetupGate";
import { DoneSection } from "./DoneSection";
import { NeedsYou } from "./NeedsYou";
import { PackCardItem } from "./PackCards";
import { MoneyHeld, NewLeads, StoreVisits, TeamStrip } from "./TodaySide";
import { SIDE_GRID } from "./side-card";
import type { TodayActions } from "./actions-types";
import { TODAY_CHIPS, type ChipKey } from "./ask/ask-chips";
import { topDecision } from "./v6/band-data";
import { buildDay } from "./v6/day-data";
import { LazyDayOne } from "./v6/day-one/LazyDayOne";
import { LazyTodayBand, LazyTodayBandAfter } from "./v6/LazyTodayBand";
import { LazyWorkingOn } from "./v6/LazyWorkingOn";
import { LazyYourDay } from "./v6/LazyYourDay";
import { ResultsCard, VisitsCard } from "./v6/Lower";
import type { V6In } from "./v6/types";
import { ASK_WORD_KEYS } from "./ask/ask-words";
import type { Availability } from "./ask/ask-types";
import { SendingBanner } from "../outbox/SendingBanner";
import { NeedsProvider } from "./needs-store";
import { dayText } from "../date-words";
import { ago, indiaDay } from "./time";
import { todayWords } from "./today-word-keys";
import type { Role, T, TodayData } from "./types";

export { ago };

/** "Sunday, 11 October": the day in India, in English; the other languages get the date the way their own locale writes it. */
export function dayLine(now: number, lang: string): string {
  const [y, m, d] = indiaDay(new Date(now).toISOString()).split("-").map(Number);
  return dayText(lang, y, m, d, { weekday: "long", month: "long" });
}

/** "Wed 14 Oct": the short day for a phone's one slim line (the long one is cut off there). */
export function dayShort(now: number, lang: string): string {
  const [y, m, d] = indiaDay(new Date(now).toISOString()).split("-").map(Number);
  return dayText(lang, y, m, d, { weekday: "short", month: "short" });
}

/** The most cards the summary row holds. */
const SUMMARY = 4;
type RowInput = { packCards: readonly PackCard[]; deskTeam: TodayData["deskTeam"]; newLeads: number | null; store: TodayData["store"]; digest: TodayData["digest"]; cards: TodayData["cards"]; role: Role; hasOrders: boolean; base: string; t: T; now: number; words: ReturnType<typeof todayWords>; outboxHref: string | null; calendarHref: string | null };
/**
 * The cards of the summary row, in order: the business type's own (each one whose figure could be read), then New leads, At the store today (not where the business type counts its own visits), Done while you slept and Money held (only
 * a business that takes orders; the Owner and Admin), up to four. A part that cannot be read, or that does not exist for this business, is no card at all.
 */
function summaryRow(r: RowInput) {
  const own = r.packCards.filter((c) => c.value !== null).map((c) => <PackCardItem key={`pack-${c.id}`} card={c} t={r.t} />);
  const leads = r.deskTeam?.some((w) => w.key === "leads") || r.newLeads !== null;
  const shop = [
    leads ? <NewLeads key="leads" deskTeam={r.deskTeam} count={r.newLeads} base={r.base} t={r.t} now={r.now} /> : null,
    r.store !== null && r.store.state === "ready" && !r.packCards.some((c) => c.id === "campus") ? <StoreVisits key="store" store={r.store} calendarHref={r.calendarHref ?? `${r.base}/visits`} bookHref={r.role === "viewer" ? null : `${r.base}/visits#book`} t={r.t} /> : null,
    r.digest !== null ? <DoneSection key="done" digest={r.digest} words={r.words} outboxHref={r.outboxHref} /> : null,
    r.hasOrders && (r.role === "owner" || r.role === "admin") ? <MoneyHeld key="money" cards={r.cards} base={r.base} t={r.t} money={formatRupeesShort} /> : null,
  ].filter((c) => c !== null);
  return [...own, ...shop].slice(0, SUMMARY);
}

/** The helpers that have something in "Needs you" (the row's agent; a held message or a call request is the Follow-up Desk's, a visit the assistant proposed is the assistant's own): their card says "Waiting for you". */
function waitingFor(needs: TodayData["needs"]): ReadonlySet<string> {
  return new Set((needs ?? []).map((c) => (c.type === "item" ? c.item.agent : c.type === "visit" ? "main" : "followup_desk")));
}

/**
 * The Today screen (job AU), as the owner-approved design draws it: the date and greeting with the usage card; the Agent OWL card (the plush owl and its mood, one sentence built from the real list,
 * the overnight line, the Ask box and three chips); "Needs you" with one card per thing that waits (WhatsApp messages held for approval, calls, and the older kinds); and, beside it (below it on a
 * phone), "At the store today", "Done while you slept" and "Your team". It only draws what `data` holds: a null part says "Not available yet"; a section with no data is not drawn. `actions` are the
 * server actions the cards call (null: the cards offer no buttons); `role` decides which buttons are shown. `now` (ms) pins the clock for the times on the screen. `name` null = the plain greeting.
 */
/** "5:30 pm" in India, in the person's language. */
function timeText(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function TodayView({ v6 = null, v5 = false, hero = null, plan = null, chipKeys = null, newLeads = null, hasOrders = true, intro = null, exampleLine = null, live = null, outcomes = null, data, name, hour, now, base, t, lang = "en", role, actions = null, outboxHref = null, calendarHref = null, help = null, packCards = [], demo = false }: { /** The design system v6 (DESIGN_V6): the top band (or the day-one checklist) replaces the hero and the command bar; null = Today as it was. */ v6?: V6In | null; /** App v4's hero (APP_V4): drawn first, with the composer under it and Needs you after; null = Today as it was. */ hero?: React.ReactNode; /** App v4's morning plan or evening report, under the composer; null = none. */ plan?: React.ReactNode; /** Today v5 (TODAY_V5): the totals after calls and the team strip are folded under one line, "More on Today". */ v5?: boolean; /** The assistant's chips (`todayChips`): the four this workspace can do; null = the three that always work. */ chipKeys?: readonly ChipKey[] | null; /** New leads not opened yet (C1's nav-counts, server side); null = not known: no New leads card unless Lead Desk says it. */ newLeads?: number | null; /** The business takes orders (its pack has the module): the Money held card. */ hasOrders?: boolean; /** "Finish setting up": drawn under the cards. */ intro?: ReactNode; /** The example-data notice, ONE slim line under the greeting. */ exampleLine?: ReactNode; /** A demo workspace (lib/workspace-demo.ts): the sending banner says so. */ demo?: boolean; /** A call that is going on (job DM), drawn under the assistant card; null = not drawn. */ live?: React.ReactNode; /** Today's totals of what happened after the calls and follow-ups (job DM), drawn under the assistant card; null = not drawn. */ outcomes?: React.ReactNode; /** The cards a business type adds (jobs CO, CS): the first cards of the summary row. */ packCards?: readonly PackCard[]; /** The "?" tip of the screen (job BT): drawn under the heading. */ help?: React.ReactNode; data: TodayData; name: string | null; hour: number; now: number; base: string; t: T; lang?: string; role: Role; actions?: TodayActions | null; outboxHref?: string | null; calendarHref?: string | null }) {
  const { cards, needs, team, deskTeam, store, sending, digest } = data;
  const main = team?.find((a) => a.agent === "main")?.state;
  const availability: Availability = main === "idle" || main === "working" ? "live" : main === "switched_off" ? "switched_off" : "not_available";
  const greet = t(hour < 12 ? "today.greeting.morning" : hour < 17 ? "today.greeting.afternoon" : "today.greeting.evening");
  const words = todayWords(t);
  const chips = (chipKeys ?? TODAY_CHIPS).map((k) => t(k));
  // design system v6: the band's facts are Today's own data (a part that cannot be read is left out, never guessed)
  const ready = store?.state === "ready" ? store : null;
  const bandFacts = { enquiries: newLeads, visits: ready ? ready.visits.length : null };
  const askWords: Record<string, string> = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, t(k)]));
  // "Your day": today's calls (read by the page), the visits (the store's own list), the call-backs still planned (the people left to call in the approved job)
  const dayView = v6
    ? buildDay({
        now,
        calls: v6.dayCalls,
        visits: ready ? ready.visits.map((v) => ({ startsAt: v.starts_at, who: v.who })) : null,
        sent: cards.waiting,
        planned: v6.working && v6.working.waiting > 0 ? { n: v6.working.waiting, toMinute: v6.working.toMinute } : null,
      })
    : null;
  // Today's visits for the v6 list: the time in India (24 hours), the name, the topic
  const visitRows = (ready?.visits ?? []).map((v) => ({ id: v.id, time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date(v.starts_at)), who: v.extra > 0 ? `${v.who} +${v.extra}` : v.who, line: v.topic }));
  return (
    <div data-screen="today" {...(v6 ? { "data-v6": "" } : {})} className="flex flex-col gap-4 md:gap-5">
      <header className={v6 ? "sr-only" : "flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-4"}>
        <div>
          {/* the page's H1 is the menu's word, "Today" (owner rule, 6 Nov: every menu item opens its own page with the menu's word as its H1), beside the date; the greeting stays the big line */}
          {v6 ? (
            // design system v6: the page's H1 is the menu's word (for a screen reader); the greeting, the "Finish setup" chip and "Watching for leads" are in the band's first line
            <h1 className="sr-only" data-part="v6-heading">
              {t("nav.item.m-today")}
            </h1>
) : hero ? (
            // app v4 (owner, 6 Nov 2026): the greeting, small, on the one slim line with the date ("Good evening, Gowtham · Friday, 6 November"); the page's H1 is still the menu's word, for a screen reader;
            // the line never wraps: a long name shortens the date, and under 360 px the date drops
            <div className="flex min-w-0 items-baseline gap-x-1.5 whitespace-nowrap text-sm text-muted" data-part="v4-heading">
              <h1 className="sr-only">{t("nav.item.m-today")}</h1>
              <span data-part="greeting" className="shrink-0 font-semibold text-ink">
                {name ? t("today.greeting.named", { greet, name }) : greet}
              </span>
              <span aria-hidden="true" className="max-[359px]:hidden">
                ·
              </span>
              <span className="shrink-0 sm:hidden max-[359px]:hidden">{dayShort(now, lang)}</span>
              <span className="hidden min-w-0 truncate sm:inline">{dayLine(now, lang)}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted">
              <h1 className="font-semibold text-ink">{t("nav.item.m-today")}</h1>
              <span aria-hidden="true">·</span>
              <span>{dayLine(now, lang)}</span>
            </div>
          )}
          {/* the member's own name (My profile), with the respectful form of the language (Telugu "గారు", Hindi "जी", Kannada "ಅವರೇ"; English the name alone: never sir or madam); none when they have no name */}
          {/* app v4: the assistant's hero is the first thing on Today (owner, 6 Nov 2026): the greeting is small, on the slim line above */}
          {hero || v6 ? null : <h2 data-part="greeting" className="font-display text-[26px] font-semibold leading-[1.15] md:text-[32px] md:leading-[1.1]">{name ? t("today.greeting.named", { greet, name }) : greet}</h2>}
        </div>
        {v6 ? null : <LiveNow tenantId={base.split("/").pop() ?? ""} />}
      </header>
      {v6 ? exampleLine ? <div className="order-last">{exampleLine}</div> : null : exampleLine}
      {help}
      {sending?.stopped ? <SendingBanner words={words} demo={demo} /> : null}
      <NeedsProvider initial={needs} waiting={cards.waiting}>
        {/* app v4 (APP_V4): the hero first, the composer exactly as it was under it, then Needs you */}
        {hero}
        {hero || v6 ? null : <NeedsYou words={words} role={role} actions={actions} now={now} lang={lang} />}
        {v6 ? null : <CommandBar lang={lang} base={base} availability={availability} words={askWords} chips={chips} />}
        {hero && !v6 ? plan : null}
        {v6 && dayView ? (
          // design system v6, the final Today: the dark band (or the day-one checklist), the full-width "Your day", then two columns: Needs you and "Your assistant is working on" | Today's visits and "This week's results". On a phone the sections follow each other (the order classes) and "Your day" scrolls sideways.
          <>
            <div className="order-1 min-w-0">
              {v6.dayOne ? (
                <LazyDayOne {...v6.dayOne} words={v6.words} language={v6.language} />
              ) : (
                <LazyTodayBand lang={lang} base={base} availability={availability} greeting={name ? t("today.greeting.named", { greet, name }) : greet} dateLine={dayLine(now, lang)} shop={v6.shop} facts={bandFacts} top={topDecision(needs)} waiting={cards.waiting} tenantId={base.split("/").pop() ?? ""} mockLive={v6.mockLive} demoCall={v6.demoCall} liveCalls={v6.liveCalls} chip={v6.chip} words={v6.words} askWords={askWords} chips={chips} language={v6.language} businessLang={v6.businessLang} />
              )}
            </div>
            {v6.dayOne ? null : (
              <div className="order-3 min-w-0 lg:order-2">
                <LazyYourDay view={dayView} words={v6.words} tenantId={base.split("/").pop() ?? ""} mockLive={v6.mockLive} liveCalls={v6.liveCalls} />
              </div>
            )}
            <div data-part="v6-lower" className="contents lg:order-3 lg:grid lg:min-w-0 lg:grid-cols-[1.25fr_1fr] lg:items-start lg:gap-[18px]">
              <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-[18px]">
                <div className="order-2 min-w-0 lg:order-none">
                  <NeedsYou words={words} role={role} actions={actions} now={now} lang={lang} design />
                </div>
                {v6.dayOne ? null : (
                  <div className="order-4 min-w-0 lg:order-none">
                    <LazyWorkingOn working={v6.working} words={v6.words} />
                  </div>
                )}
              </div>
              <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-[18px]">
                {ready ? (
                  <div className="order-5 min-w-0 lg:order-none">
                    <VisitsCard rows={visitRows} t={t} />
                  </div>
                ) : null}
                <div className="order-6 min-w-0 lg:order-none">
                  <ResultsCard stages={v6.results.stages} costs={v6.results.costs} t={t} />
                </div>
              </div>
            </div>
          </>
        ) : null}
        {hero ? <NeedsYou words={words} role={role} actions={actions} now={now} lang={lang} /> : null}
        {v6 && !v6.dayOne ? (
          <div className="order-last">
            <LazyTodayBandAfter words={v6.words} language={v6.language} businessLang={v6.businessLang} />
          </div>
        ) : null}
        {/* app v4: "Finish setting up" comes here as one slim line (the setup's own component puts it here) */}
        {hero ? <SetupSlot /> : null}
        {v6 ? null : live}
        {v6 ? null : (
          <>
        {v5 ? null : outcomes}
        {/* the summary cards, side by side (four on a wide screen) */}
        {/* the summary row (owner's review, 5 Nov): the business type's own cards first (a school: fees collected, reminders, campus visits, admissions waiting), then the shop's, four at most; never another business type's card */}
        <div className={SIDE_GRID}>{summaryRow({ packCards, deskTeam, newLeads, store, digest, cards, role, hasOrders, base, t, now, words, outboxHref, calendarHref })}</div>
        {v5 ? (
          // Today v5: the totals after calls and the team strip, folded; a closed <details> costs the first paint nothing and works without script
          outcomes !== null || team !== null || deskTeam !== null ? (
            <details data-part="v5-more" className="group rounded-2xl border border-line bg-surface">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-base font-semibold [&::-webkit-details-marker]:hidden">
                <span>{t("today.v5.more")}</span>
                <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <div className="flex flex-col gap-4 px-4 pb-4">
                {outcomes}
                <TeamStrip team={team} deskTeam={deskTeam} waitingFor={waitingFor(needs)} base={base} t={t} now={now} />
              </div>
            </details>
          ) : null
        ) : (
          <TeamStrip team={team} deskTeam={deskTeam} waitingFor={waitingFor(needs)} base={base} t={t} now={now} />
        )}
          </>
        )}
        {v6 ? null : intro}
      </NeedsProvider>
    </div>
  );
}
