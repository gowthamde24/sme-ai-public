import type { ReactElement, ReactNode } from "react";

import { early, Part, settle } from "@/components/v2/app/ds/Streamed";
import { SendingBanner } from "@/components/v2/app/outbox/SendingBanner";
import { ExampleBanner, type ExampleNotice } from "@/components/v2/app/start/ExampleBanner";
import { NeedsProvider } from "@/components/v2/app/today/needs-store";
import { NeedsYou } from "@/components/v2/app/today/NeedsYou";
import { OffersLine } from "@/components/v2/app/today/OffersLine";
import { ASK_WORD_KEYS } from "@/components/v2/app/today/ask/ask-words";
import { TODAY_CHIPS, type ChipKey } from "@/components/v2/app/today/ask/ask-chips";
import { dayLine } from "@/components/v2/app/today/TodayView";
import { todayWords } from "@/components/v2/app/today/today-word-keys";
import type { Role, T } from "@/components/v2/app/today/types";
import { LazyDayOne } from "@/components/v2/app/today/v6/day-one/LazyDayOne";
import { LazyTodayBand, LazyTodayBandAfter } from "@/components/v2/app/today/v6/LazyTodayBand";
import { LazyWorkingOn } from "@/components/v2/app/today/v6/LazyWorkingOn";
import { LazyYourDay } from "@/components/v2/app/today/v6/LazyYourDay";
import { ResultsCard, VisitsCard } from "@/components/v2/app/today/v6/Lower";
import { todayOpen } from "@/lib/screens/flag";
import { quoteCandidates } from "@/components/v2/app/today/v6/band-data";
import { availabilityOf, briefOf, dayViewOf, readyStore, visitRowsOf } from "@/components/v2/app/today/v6/stream-data";
import { BandPlaceholder, BriefingPlaceholder, NeedsPlaceholder, PartUnavailable, ResultsPlaceholder, VisitsPlaceholder, WorkingPlaceholder, YourDayPlaceholder } from "@/components/v2/app/today/v6/Placeholders";
import { Briefing, BriefingFast, briefingSecond } from "@/components/v2/app/today/v6/Briefing";
import { NeedsBox, ResultsBox, V6Layout, VisitsBox, WorkingBox, YourDayBox } from "@/components/v2/app/today/v6/V6Layout";
import { pageMainToday } from "@/components/v2/app/ui";
import { wordsFor } from "@/i18n/app-words";
import type { AppT } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { getExampleStatus } from "@/lib/api/example-data";
import { getTodayBriefing, type TodayBriefing } from "@/lib/api/today-briefing";
import { timed } from "@/lib/observe/server-timing";
import { getNavCounts, todayCount, type NavCounts } from "@/lib/api/nav-counts";
import { mayHaveCampusCard, readPackCards, type PackCard } from "@/lib/packs/pack-cards";
import { usesChecklist } from "@/lib/packs/activation";
import type { WorkspacePack } from "@/lib/packs/types";
import { formatRupeesShort } from "@/lib/money";

import { loadExampleAction, removeExampleAction, resetExampleAction } from "./start/actions";
import { readLeadDesk, sourceNameOf } from "./lead-desk-today";
import { readFinderNeeds } from "./lead-finder-today";
import { readOffersWaiting } from "./offers-waiting";
import { composeToday, type FinderState } from "./today-compose";
import { todayActionsFor } from "./today-bind";
import { readDisplayName, readToday } from "./today-data";
import { readAgentsCached, readIsDemo } from "./today-read";
import { startV6 } from "./today-v6";
import { topupsToday } from "./topups-today";

/**
 * Today in the design system v6, drawn in PARTS as they are read (staging, 19 Nov 2026: the briefing line, the largest paint, came last, after the slowest read of the whole page). The page's box, its heading and a placeholder the size of each part go out first; every part then
 * arrives when ITS reads are done and takes the room of its placeholder:
 *   1. the dark band (or the day-one checklist): the person's name, the assistant's state, the checklist's facts; its briefing line is a part of its own inside it, and waits only for what its words need (Today's own data and the menu's numbers)
 *   2. "Needs you": Today's data with Lead Desk's items and the Lead Finder's businesses joined
 *   3. the rest: "Your day", "Your assistant is working on", today's visits and this week's results
 * and the notices (sending stopped, the example data, a top-up) at their own places. Every read starts HERE, at once, and each is made ONCE: the parts share the same promises. What the v6 page never drew (the older cards, the totals, the stand-up, the setup facts) is not read.
 * The text of every part is the text the page had when it waited for everything (test/screens: today-v6*).
 */
/** A read that cannot be had is no number; a rejected session still goes to sign-in. */
const orNull = (error: unknown): null => {
  if (error instanceof ApiAuthError) throw error;
  return null;
};

export type StreamIn = {
  /** C1's small briefing read, asked by the caller at once (`briefing`), and what it had said within 300 ms (`briefingNow`, null = not yet or not told): the placeholders are sized from it. */
  briefing?: Promise<TodayBriefing | null>;
  briefingNow?: TodayBriefing | null;
  accessToken: string;
  userId: string;
  tenantId: string;
  role: Role;
  shop: string;
  lang: Lang;
  /** The business type, read once for the request; null = the product as it always was. */
  pack: WorkspacePack | null;
  t: AppT;
  tt: T;
  base: string;
  now: number;
  hour: number;
  deskPack: boolean;
  finderState: FinderState;
  chipKeys: readonly ChipKey[] | null;
  example: string | null;
  kept: number;
  setupParam: string | null;
  liveParam: string | null;
  /** The "?" tip under the heading. */
  help: ReactNode;
};

/** Draws Today (design system v6, Owner, Admin and Sales) in parts. Starts every read at once; returns the page's box straight away. */
export function streamedToday(i: StreamIn): ReactElement {
  const { accessToken, userId, tenantId, role, pack, t, tt, base, now, lang } = i;
  const manages = role === "owner" || role === "admin";
  const ctx = { token: accessToken, tenantId, userId };

  // ---- every read of the page starts here, once ----
  const agentsAsked = early(readAgentsCached(accessToken, tenantId));
  const todayAsked = early(timed("today_read", () => readToday(accessToken, tenantId, role, Date.now, { agents: agentsAsked })));
  const nameAsked = early(readDisplayName(accessToken, tenantId, userId));
  const countsAsked: Promise<NavCounts | null> = early(timed("nav_counts", () => getNavCounts(accessToken, tenantId)).catch(orNull)); // the menu's numbers (C1's nav-counts, cached 30 s by the API): one that cannot be read is no number
  const deskAsked = early(readLeadDesk(ctx, role, base, tt, (tag) => sourceNameOf(tt, tag), now, false)); // (the Lead Desk workers of "Your team" are not drawn in v6: their reads are not made)
  const finderAsked = early(readFinderNeeds({ token: accessToken, tenantId }, role, i.finderState, base, tt));
  // the business type's own cards are not drawn in v6; only a school's campus card still matters (it takes the visits off the band's line), so only a business type that can have it reads them
  const campusMay = mayHaveCampusCard(pack, role);
  const cardsAsked: Promise<readonly PackCard[]> = early(campusMay ? readPackCards({ accessToken, tenantId, role, pack, now, formatMoney: formatRupeesShort }) : Promise.resolve([]));
  const sampleAsked = early(manages && pack ? getExampleStatus(accessToken, tenantId) : Promise.resolve(null));
  const demoAsked = early(readIsDemo(accessToken, tenantId, i.shop));
  const topupsAsked = early(manages ? topupsToday({ token: accessToken, tenantId, lang, owner: role === "owner" }) : Promise.resolve(null));
  const offersAsked = early(readOffersWaiting(accessToken, tenantId, role, base)); // the Owner's "offers waiting for your approval" line (OFFER_SCREENS); nothing for anyone else
  const v6 = startV6({ token: accessToken, tenantId, userId, role, lang, shop: i.shop, userName: nameAsked, modules: pack?.modules ?? [], setup: i.setupParam, live: i.liveParam, base });
  if (!v6) throw new Error("Today in parts is for the design system v6");

  const greet = t(i.hour < 12 ? "today.greeting.morning" : i.hour < 17 ? "today.greeting.afternoon" : "today.greeting.evening");
  const words = todayWords(tt);
  const actions = todayActionsFor(tenantId, role);
  const chips = (i.chipKeys ?? TODAY_CHIPS).map((k) => tt(k));
  const askWords: Record<string, string> = Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, tt(k)]));
  const briefWords = wordsFor(lang, ["tv6.line.", "tv6.brief."]);
  const tenant = base.split("/").pop() ?? "";

  // ---- Today's own data with the rest joined (Lead Desk, the Lead Finder, the menu's numbers): one function, the same as the page that waits for everything ----
  const campusOf = async (): Promise<boolean> => (await cardsAsked).some((c) => c.id === "campus");
  const composed = early(
    Promise.all([todayAsked, deskAsked, finderAsked, countsAsked, campusOf()]).then(([raw, desk, finder, counts, campus]) => composeToday(raw, { desk, finder, deskPack: i.deskPack, counts, campus, finderState: i.finderState, role, base, tt, now })),
  );

  // ---- 1. the briefing: what its own words need ----
  // Today's own data and the menu's numbers. Lead Desk's items re-sort the list (newest first), so the quote it names comes from the finished list only when two quotes could be named, or when the menu's number is not known (then the count is the merged one)
  const brief = early(
    (async () => {
      const [raw, counts] = await Promise.all([todayAsked, countsAsked]);
      const waitingKnown = counts !== null && todayCount(counts) !== null;
      if (!waitingKnown || quoteCandidates(raw.needs) > 1) return briefOf((await composed).data, (await composed).newLeads);
      const campus = await campusOf();
      return briefOf(composeToday(raw, { desk: { needs: [], team: [] }, finder: [], deskPack: i.deskPack, counts, campus, finderState: "hidden", role, base, tt, now }).data, counts?.newLeads ?? null);
    })(),
  );
  // C1's small briefing read (counts only, about 150 bytes, 19 Nov): the first sentence and the count of things waiting are painted from it at once; the quote sentence replaces the count in the second slot when the finished list is read (the fallback is the same sentence made from the count, so nothing moves). A business type that can have a campus card (it takes the visits off the line) or an API without the route waits for the big reads as before.
  const briefingAsked = early(campusMay ? Promise.resolve(null) : (i.briefing ?? getTodayBriefing(accessToken, tenantId)));
  // (the caller waited for it up to 300 ms) the placeholders are sized for what is coming: a phone's "Needs you" rows, a quote's long sentence: nothing moves when the real parts arrive
  const fastEarly = campusMay ? null : (i.briefingNow ?? null);
  // while the small read has not answered (a cold start: more than the 300 ms the page waits) the briefing line may be the long one (the quote sentence), so the placeholder holds four lines: two blank lines under a short briefing cost nothing, a briefing that grows by two lines moved the whole page (staging 19 Nov: CLS 0.048)
  const briefNode = settle(
    briefingAsked.then(async (fast): Promise<ReactNode> => {
      if (!fast || (fast.newLeads === null && fast.visitsToday === null && fast.needsYou === null)) {
        const b = await brief;
        return <Briefing facts={b.facts} top={b.top} waiting={b.waiting} words={briefWords} />;
      }
      const counted = briefingSecond(null, fast.needsYou, briefWords);
      const finalSecond = settle(brief.then((b): ReactNode => briefingSecond(b.top, b.waiting, briefWords)));
      return <BriefingFast facts={{ enquiries: fast.newLeads, visits: fast.visitsToday }} reserveQuote={(fast.quotesWaiting ?? 0) > 0} words={briefWords} second={<Part of={finalSecond} fallback={counted} quiet={counted} />} />;
    }),
  );

  // ---- the band (or the day-one checklist) ----
  const bandNode = settle(
    Promise.all([v6.band, nameAsked, agentsAsked.catch(orNull)]).then(([b, name, agents]): ReactNode => {
      if (b.dayOne) return <LazyDayOne {...b.dayOne} words={b.words} language={b.language} />;
      return (
        <LazyTodayBand
          lang={lang}
          base={base}
          availability={availabilityOf(agents)}
          greeting={name ? t("today.greeting.named", { greet, name }) : greet}
          dateLine={dayLine(now, lang)}
          shop={b.shop}
          tenantId={tenant}
          mockLive={b.mockLive}
          demoCall={b.demoCall}
          liveCalls={b.liveCalls}
          chip={b.chip}
          words={b.words}
          askWords={askWords}
          chips={chips}
          language={b.language}
          businessLang={b.businessLang}
          briefing={<Part of={briefNode} fallback={<BriefingPlaceholder lines={(campusMay ? 0 : (fastEarly?.quotesWaiting ?? 1)) > 0 ? 4 : 2} />} />}
        />
      );
    }),
  );
  const afterNode = settle(v6.band.then((b): ReactNode => (b.dayOne ? null : <div className="order-last"><LazyTodayBandAfter words={b.words} language={b.language} businessLang={b.businessLang} /></div>)));

  // ---- 2. "Needs you" ----
  const needsNode = settle(
    Promise.all([composed, offersAsked, v6.jobs]).then(([{ data }, offersWaiting, jobs]): ReactNode => {
      const offers = offersWaiting ? { line: offersWaiting.count === 1 ? t("today.offers.one") : t("today.offers.other", { n: offersWaiting.count }), open: t("today.offers.open"), href: offersWaiting.href } : null;
      return (
        <NeedsBox>
          {offers ? <div className="mb-3"><OffersLine {...offers} /></div> : null}
          <NeedsProvider initial={data.needs} waiting={data.cards.waiting}>
            <NeedsYou words={words} role={role} actions={actions} now={now} lang={lang} design />
          </NeedsProvider>
          {jobs ? <div className="mt-[18px]">{jobs}</div> : null}
        </NeedsBox>
      );
    }),
  );

  // ---- 3. the rest ----
  const rest = early(Promise.all([v6.band, v6.lower, composed]).then(([band, lower, { data }]) => ({ dayOne: band.dayOne !== null, words: band.words, lower, ready: readyStore(data.store), mockLive: band.mockLive, liveCalls: band.liveCalls })));
  const yourDayNode = settle(rest.then((r): ReactNode => (r.dayOne ? null : <YourDayBox><LazyYourDay view={dayViewOf(now, r.lower, r.ready)} words={r.words} tenantId={tenant} mockLive={r.mockLive} liveCalls={r.liveCalls} /></YourDayBox>)));
  const workingNode = settle(rest.then((r): ReactNode => (r.dayOne ? null : <WorkingBox><LazyWorkingOn working={r.lower.working} words={r.words} /></WorkingBox>)));
  const visitsNode = settle(rest.then((r): ReactNode => (r.ready ? <VisitsBox><VisitsCard rows={visitRowsOf(r.ready)} t={tt} /></VisitsBox> : null)));
  const resultsNode = settle(rest.then((r): ReactNode => <ResultsBox><ResultsCard stages={r.lower.results.stages} costs={r.lower.results.costs} t={tt} /></ResultsBox>));

  // ---- the notices ----
  const sendingNode = settle(Promise.all([todayAsked, demoAsked]).then(([data, demo]): ReactNode => (data.sending?.stopped ? <SendingBanner words={words} demo={demo} /> : null)));
  const exampleNode = settle(
    sampleAsked.then((sample): ReactNode => {
      // the "example data" banner (blueprint 3.2) is the first-run offer of a workspace made with a chosen business type; a workspace that existed before business types sees it only while a sample is loaded (so it can be removed)
      const showSample = sample !== null && (sample.loaded || (usesChecklist(pack) && pack?.hasExampleData !== false));
      const notice: ExampleNotice = i.example === "loaded" || i.example === "removed" || i.example === "reset" || i.example === "unavailable" || i.example === "failed" ? i.example : null;
      return showSample && sample ? <div className="order-last"><ExampleBanner state={sample.loaded ? "loaded" : "available"} notice={notice} kept={i.kept} load={loadExampleAction.bind(null, tenantId)} remove={removeExampleAction.bind(null, tenantId)} reset={resetExampleAction.bind(null, tenantId)} t={t} /></div> : null;
    }),
  );
  const topupsNode = settle(topupsAsked);

  return (
    <main className={pageMainToday} lang={lang}>
      <Part of={topupsNode} fallback={null} />
      <div data-screen="today" data-v6="" {...(todayOpen() ? { "data-open": "today" } : {})} className="flex flex-col gap-4 md:gap-5">
        <header className="sr-only">
          <div>
            <h1 className="sr-only" data-part="v6-heading">
              {t("nav.item.m-today")}
            </h1>
          </div>
        </header>
        <Part of={exampleNode} fallback={null} />
        {i.help}
        <Part of={sendingNode} fallback={null} />
        <V6Layout
          band={
            <Part
              of={bandNode}
              fallback={<BandPlaceholder tall={(campusMay ? 0 : (fastEarly?.quotesWaiting ?? 1)) > 0} />}
              quiet={<PartUnavailable>{t("frame.notyet")}</PartUnavailable>}
            />
          }
          yourDay={<Part of={yourDayNode} fallback={<YourDayPlaceholder />} />}
          needs={<Part of={needsNode} fallback={<NeedsPlaceholder rows={fastEarly?.needsYou ?? null} />} />}
          working={<Part of={workingNode} fallback={<WorkingPlaceholder />} />}
          visits={<Part of={visitsNode} fallback={<VisitsPlaceholder />} />}
          results={<Part of={resultsNode} fallback={<ResultsPlaceholder />} />}
        />
        <Part of={afterNode} fallback={null} />
      </div>
    </main>
  );
}
