import { redirect } from "next/navigation";

import { AiTeamView } from "@/components/v2/app/aiteam/LazyAiTeamView";
import { AiTeamTabs, EarlierReports, ExampleData, ReportLayout, TodoTomorrow, type V4Tab } from "@/components/v2/app/aiteam/AiTeamV4";
import { HelpersTab } from "@/components/v2/app/aiteam/LazyHelpersTab";
import { StandupScene, type Waiting } from "@/components/v2/app/aiteam/StandupScene";
import { StandupCard } from "@/components/v2/app/aiteam/LazyStandupCard"; // (a chunk of its own: with app v4 the page has the scene instead, and the route-JS budget counts what the page imports)
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import type { Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { getNavCounts } from "@/lib/api/nav-counts";
import { getAiAssistant } from "@/lib/api/ai-assistant";
import { dayWords, earlierDates, todoCards } from "@/lib/aiteam/standup-steps";
import { appV4 } from "@/lib/screens/flag";

import { menuTitle } from "../menu-title";
import { remakeStandupAction, switchHelperAction } from "./actions";
import { dayOrToday, readDay, readStandup, todayIndia, type TeamCtx } from "./ai-team-data";
import { teamWords } from "./team-words";

/** /ai-team when AI_TEAM_SCREENS is on (job ai-team-v2): the stand-up (Owner, Admin), the flow strip, today's shift and the helper panel. The first paint is the server's day; the browser then follows it live. */
export async function AiTeamV2Page({ ctx, lang, wantedDate, wantedTab }: { ctx: TeamCtx; lang: Lang; wantedDate: string | undefined; wantedTab?: string }) {
  if (appV4()) return AiTeamV4Page({ ctx, lang, wantedDate, wantedTab });
  const base = `/app/tenants/${ctx.tenantId}`;
  const today = todayIndia();
  const date = dayOrToday(wantedDate);
  const manages = ctx.role === "owner" || ctx.role === "admin";
  const words = teamWords(lang);
  let day;
  let standup = null;
  try {
    [day, standup] = await Promise.all([readDay(ctx, date), manages ? readStandup(ctx, date).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)) : Promise.resolve(null)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const title = await menuTitle("aiteam", lang, ctx.token, ctx.tenantId);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={title} sub={words["aiteam.sub"]} />
      <AiTeamView
        key={date}
        tenantId={ctx.tenantId}
        base={base}
        date={date}
        today={today}
        initialDay={day}
        words={words}
        manages={manages}
        onSwitch={manages ? switchHelperAction.bind(null, ctx.tenantId) : null}
        mfaHref={`${base}/settings?section=security`}
        standup={manages ? <StandupCard key={date} base={base} date={date} isToday={date === today} initial={standup} words={words} remake={remakeStandupAction.bind(null, ctx.tenantId)} /> : undefined}
      />
    </main>
  );
}

const LOCALE: Record<string, string> = { en: "en-IN", te: "te-IN", hi: "hi-IN", kn: "kn-IN" };

/**
 * /ai-team with APP_V4 (app v4 part 7, from app-Standup.png): three parts as tabs. "Today's report" (the Owner's and Admin's) is the stand-up as a scene (the assistant, the helpers round it, "X is reporting", the steps) with "To do tomorrow"
 * (what waits for the person, from the menu's own counts) and "Earlier reports" (the days before that really had one) beside it; "Today's shift" is the live shift as it was; "Helpers" is a card for each helper, opening its panel.
 */
async function AiTeamV4Page({ ctx, lang, wantedDate, wantedTab }: { ctx: TeamCtx; lang: Lang; wantedDate: string | undefined; wantedTab: string | undefined }) {
  const base = `/app/tenants/${ctx.tenantId}`;
  const today = todayIndia();
  const date = dayOrToday(wantedDate);
  const manages = ctx.role === "owner" || ctx.role === "admin";
  const words = teamWords(lang);
  const tabs: V4Tab[] = manages ? ["report", "shift", "helpers"] : ["shift", "helpers"];
  const tab: V4Tab = (tabs as readonly string[]).includes(wantedTab ?? "") ? (wantedTab as V4Tab) : tabs[0];
  const quiet = <T,>(p: Promise<T>): Promise<T | null> => p.catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null));
  let day;
  let standup = null;
  let counts = null;
  let waiting: Waiting | null = null;
  let earlier: { date: string; seconds: number | null }[] = [];
  try {
    day = await readDay(ctx, date);
    if (tab === "report") {
      const before = earlierDates(today, 6);
      const [s, c, past] = await Promise.all([quiet(readStandup(ctx, date)), quiet(getNavCounts(ctx.token, ctx.tenantId)), Promise.all(before.map((d) => quiet(readStandup(ctx, d))))]);
      standup = s;
      counts = c;
      if (!s && date === today) {
        // why there is none yet: no assistant saved (set it up first), before opening time (when it comes), or after it (not made yet, with the button)
        const a = ctx.mode === "on" ? await quiet(getAiAssistant(ctx.token, ctx.tenantId)) : null;
        const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
        waiting = a && !a.saved ? { kind: "setup", href: `${base}/settings?section=assistant` } : nowHm < day.day.opens ? { kind: "before", time: day.day.opens } : { kind: "notyet" };
      }
      earlier = before.flatMap((d, i) => (past[i] ? [{ date: d, seconds: null }] : [])); // (no sound, so no length to show)
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const title = await menuTitle("aiteam", lang, ctx.token, ctx.tenantId);
  const helperNames = Object.fromEntries(Object.entries(words).filter(([k]) => k.startsWith("aiteam.helper.")).map(([k, v]) => [k.slice("aiteam.helper.".length), v]));
  const mfaHref = `${base}/settings?section=security`;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={title} sub={<>{words["aiteam.v4.sub"]}{ctx.mode === "mock" ? <ExampleData words={words} /> : null}</>} action={<AiTeamTabs words={words} base={base} tabs={tabs} current={tab} date={date} today={today} />} />
      {tab === "report" ? (
        <ReportLayout
          scene={
            <StandupScene
              key={date}
              base={base}
              date={date}
              isToday={date === today}
              initial={standup}
              words={words}
              helperNames={helperNames}
              orbs={day.lanes.map((l) => l.helper).slice(0, 6)}
              remake={remakeStandupAction.bind(null, ctx.tenantId)}
              dayLabel={dayWords(date, LOCALE[lang] ?? "en-IN")}
              waiting={waiting}
            />
          }
          side={
            <>
              <TodoTomorrow words={words} todos={todoCards(counts, base, { finder: counts?.prospectsNeedingOwner != null })} />
              <EarlierReports words={words} base={base} locale={LOCALE[lang] ?? "en-IN"} items={earlier} current={date} />
            </>
          }
        />
      ) : null}
      {tab === "shift" ? <AiTeamView key={date} tenantId={ctx.tenantId} base={base} date={date} today={today} initialDay={day} words={words} manages={manages} onSwitch={manages ? switchHelperAction.bind(null, ctx.tenantId) : null} mfaHref={mfaHref} tab="shift" quiet /> : null}
      {tab === "helpers" ? <HelpersTab tenantId={ctx.tenantId} base={base} day={day} words={words} manages={manages} onSwitch={manages ? switchHelperAction.bind(null, ctx.tenantId) : null} mfaHref={mfaHref} /> : null}
    </main>
  );
}
