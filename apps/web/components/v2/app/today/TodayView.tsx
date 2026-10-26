
import { AgentHero } from "./AgentHero";
import { DoneSection } from "./DoneSection";
import { NeedsYou } from "./NeedsYou";
import { TeamSection, StoreVisits } from "./TodaySide";
import { TodayUsage } from "./TodayUsage";
import type { TodayActions } from "./actions-types";
import { TODAY_CHIPS } from "./ask/ask-chips";
import { ASK_WORD_KEYS } from "./ask/ask-words";
import type { Availability } from "./ask/ask-types";
import { SendingBanner } from "../outbox/SendingBanner";
import { NeedsProvider } from "./needs-store";
import { dayText } from "../date-words";
import { ago, indiaDay } from "./time";
import { todayWords } from "./today-words";
import type { Role, T, TodayData } from "./types";

export { ago };

/** "Sunday, 11 October": the day in India, in English; the other languages get the date the way their own locale writes it. */
export function dayLine(now: number, lang: string): string {
  const [y, m, d] = indiaDay(new Date(now).toISOString()).split("-").map(Number);
  return dayText(lang, y, m, d, { weekday: "long", month: "long" });
}

/**
 * The Today screen (job AU), as the owner-approved design draws it: the date and greeting with the usage card; the Agent OWL card (the plush owl and its mood, one sentence built from the real list,
 * the overnight line, the Ask box and three chips); "Needs you" with one card per thing that waits (WhatsApp messages held for approval, calls, and the older kinds); and, beside it (below it on a
 * phone), "At the store today", "Done while you slept" and "Your team". It only draws what `data` holds: a null part says "Not available yet"; a section with no data is not drawn. `actions` are the
 * server actions the cards call (null: the cards offer no buttons); `role` decides which buttons are shown. `now` (ms) pins the clock for the times on the screen. `name` null = the plain greeting.
 */
export function TodayView({ live = null, outcomes = null, data, name, hour, now, base, t, lang = "en", role, actions = null, outboxHref = null, calendarHref = null, help = null, packCards = null, demo = false }: { /** A demo workspace (lib/workspace-demo.ts): the sending banner says so. */ demo?: boolean; /** A call that is going on (job DM), drawn under the assistant card; null = not drawn. */ live?: React.ReactNode; /** Today's totals of what happened after the calls and follow-ups (job DM), drawn under the assistant card; null = not drawn. */ outcomes?: React.ReactNode; /** The cards a business type adds (jobs CO, CS), drawn first in the side column. */ packCards?: React.ReactNode; /** The "?" tip of the screen (job BT): drawn under the heading. */ help?: React.ReactNode; data: TodayData; name: string | null; hour: number; now: number; base: string; t: T; lang?: string; role: Role; actions?: TodayActions | null; outboxHref?: string | null; calendarHref?: string | null }) {
  const { cards, needs, team, store, week, sending, digest } = data;
  const main = team?.find((a) => a.agent === "main")?.state;
  const availability: Availability = main === "idle" || main === "working" ? "live" : main === "switched_off" ? "switched_off" : "not_available";
  const greet = t(hour < 12 ? "today.greeting.morning" : hour < 17 ? "today.greeting.afternoon" : "today.greeting.evening");
  const words = todayWords(t);
  const chips = TODAY_CHIPS.map((k) => t(k));
  return (
    <div data-screen="today" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{dayLine(now, lang)}</p>
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{name ? `${greet}, ${name}` : greet}</h1>
        </div>
        <TodayUsage words={words} settingsHref={`${base}/settings`} week={week} />
      </header>
      {help}
      {sending?.stopped ? <SendingBanner words={words} demo={demo} /> : null}
      <NeedsProvider initial={needs} waiting={cards.waiting}>
        <AgentHero lang={lang} base={base} availability={availability} askWords={Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, t(k)]))} words={words} chips={chips} digest={digest} />
        {live}
        {outcomes}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <NeedsYou words={words} role={role} actions={actions} now={now} lang={lang} />
          <div className="flex min-w-0 flex-col gap-6">
            {packCards}
            <StoreVisits store={store} calendarHref={calendarHref ?? `${base}/visits`} bookHref={role === "viewer" ? null : `${base}/visits#book`} t={t} />
            <DoneSection digest={digest} words={words} outboxHref={outboxHref} />
            <TeamSection team={team} base={base} t={t} now={now} />
          </div>
        </div>
      </NeedsProvider>
    </div>
  );
}
