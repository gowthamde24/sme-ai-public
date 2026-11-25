import { type ReactNode } from "react";

import { JobsToday } from "@/components/v2/app/jobs/JobsToday";
import { FinishChip } from "@/components/v2/app/today/v6/day-one/FinishChip";
import { doneCount, showChecklist, showChip, stepViews } from "@/components/v2/app/today/v6/day-one/steps";
import { todayOpen } from "@/lib/screens/flag";
import type { DayOneIn, LiveCallSeed, V6In } from "@/components/v2/app/today/v6/types";
import { wordsFor } from "@/i18n/app-words";
import { LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { listCalls } from "@/lib/api/calls";
import { readFestivals } from "@/lib/api/job-templates";
import { SampleChip } from "@/components/v2/app/jobs/SampleChip";
import { readJobsToday } from "@/lib/api/jobs";
import { festivalHint } from "@/lib/jobs/festival";
import { getProfile } from "@/lib/api/profile";
import { businessLanguage } from "@/lib/assistant/business-language";
import { endDemoCallAction, startDemoCallAction } from "./demo-call-actions";
import { readIsDemo } from "./today-read";
import { workingFrom, type Working } from "@/components/v2/app/today/v6/lower-data";
import { resultsView, type ResultsView } from "@/components/v2/app/today/v6/results-data";
import { appT } from "@/i18n/app";
import { rangeOf } from "@/lib/reports-v6/results";
import { readTasks } from "@/lib/tasks/source";
import { sourceNameOf } from "./lead-desk-today";
import { MOCK_CALL } from "@/lib/calls/mock";
import { missingFor } from "@/lib/assistant-status/go-live";
import { readDone } from "@/lib/packs/day-one-activation";
import { readAssistantStatus } from "@/lib/assistant-status/source";
import { readChoice } from "@/lib/assistant-status/setup-choice";
import { assistantStatusScreens, callScreens, demoCall, designV6, outreachScreens, taskScreens, firstDayOpen } from "@/lib/screens/flag";
import { readResultsV6 } from "./report/v6-data";
import { setJobEnabledAction } from "./jobs/actions";
import { changeSearchAction, planJobAction, startPlanAction, testPlanAction } from "./jobs/new/actions";
import { loadNewJobSheetAction } from "./jobs/sheet-actions";

import { dismissChipAction, goLiveAction, skipSetupAction, testNumberAction } from "./day-one-actions";

const early = <V,>(p: Promise<V>): Promise<V> => {
  p.catch(() => undefined);
  return p;
};

/** The pretend calls of staging (CALL_SCREENS=mock): thirteen calls between 9 am and 10:40 am today, so "Your day" has something to show. Made up; never used with the real API. */
function mockCallTimes(now: number): string[] {
  const day = new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
  return [5, 12, 18, 22, 25, 33, 40, 44, 50, 58, 65, 72, 80].map((m) => `${day}T${String(9 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+05:30`);
}

/** Today's calls (their start times) and the calls that are live now, from the calls list: the same reader as the Calls page's live strip (a row is live when the API says so). A read that fails, or takes longer than 1.5 s, is "not known" (Today never waits for it). The list is the API's newest page: with more calls than a page holds the day shows the newest. */
async function readCalls(token: string, tenantId: string): Promise<{ times: string[]; live: LiveCallSeed[]; transferred: number | null } | null> {
  try {
    const page = await Promise.race([listCalls(token, tenantId), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))]);
    if (!page) return null;
    // "sent to you" on the day line = the calls handed to the owner TODAY (status transferred, India day); unknown (an API that sends no status) = left out, never the number of cards waiting (owner, 14 Nov)
    const real = page.items.filter((c) => !c.sandbox);
    const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const transferred = real.some((c) => c.status !== null) ? real.filter((c) => c.status === "transferred" && new Date(Date.parse(c.createdAt) + 5.5 * 3600_000).toISOString().slice(0, 10) === day).length : null;
    return { transferred, times: real.map((c) => c.createdAt), live: page.items.filter((c) => c.live).slice(0, 5).map((c) => ({ id: c.id, who: c.who, elapsedS: c.elapsedS })) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** What the dark band (or the day-one checklist) needs besides Today's own data: the words, the language, the business, the checklist or the chip, the demo button and the calls that are live now. */
export type V6Band = Pick<V6In, "words" | "language" | "businessLang" | "shop" | "mockLive" | "demoCall" | "dayOne" | "chip" | "liveCalls">;
/** What the sections under the band need: the approved job, this week's results and today's calls (for "Your day"). */
export type V6Lower = Pick<V6In, "working" | "results" | "dayCalls" | "dayTransferred">;

/**
 * Everything the page gives Today for the design system v6 (null where DESIGN_V6 is off), in TWO parts that start at once and share every read: `band` (the words, the business name and language, the day one checklist, which is shown until the assistant is live unless
 * skipped, or the "Finish setup" chip, the demo button and the calls live now) and `lower` (the approved job, this week's results, today's calls for "Your day"). The page draws the band as soon as ITS part is read, and the sections under it when theirs is. `userName` may
 * still be on its way (the checklist greets the person by it, nothing else here needs it).
 * The calls flag `mock` makes pretend calls for the timeline, and `?live=1` a pretend live call (staging); with the real API the calls are read from the calls list and a live call comes from the live-call poll in the browser.
 */
export { businessLanguage } from "@/lib/assistant/business-language";

type V6Args = { token: string; tenantId: string; userId?: string; role: "owner" | "admin" | "sales" | "viewer"; lang: Lang; shop: string; userName: string | null | Promise<string | null>; modules: readonly string[]; /** `?setup=1`: the chip's link reopens the checklist. */ setup: string | null; /** `?live=1`: the pretend live call (CALL_SCREENS=mock only). */ live: string | null; base: string };

export function startV6({ token, tenantId, userId = "", role, lang, shop, userName, modules, setup, live, base }: V6Args): { band: Promise<V6Band>; lower: Promise<V6Lower>; jobs: Promise<ReactNode> } | null {
  if (!designV6()) return null;
  const manages = role === "owner" || role === "admin";
  const words = wordsFor(lang, ["tv6.", "dst.", "bv.chat.plan.", "bv.chat.state.", "bv.chat.err.", "bv.end.", "bv.live."], ["frame.ailight"]);
  const callMode = callScreens();
  const callsAsked = early<{ times: string[]; live: LiveCallSeed[]; transferred: number | null } | null>(callMode === "mock" ? Promise.resolve({ times: mockCallTimes(Date.now()), live: [], transferred: null }) : callMode === "on" && (manages || role === "sales") ? readCalls(token, tenantId) : Promise.resolve(null));
  // the business's own language (its profile's first one) is where the command bar's language dropdown starts; a profile that cannot be read leaves it to the app's language
  const profileAsked = early(manages || role === "sales" ? getProfile(token, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)) : Promise.resolve(null));
  // the approved job (the tasks API) and this week's sources (the lead report): each on its own, a part that cannot be read is simply not drawn
  const workingAsked = early<Working | null>(manages && taskScreens() !== "off" ? readTasks({ token, tenantId }).then((r) => (r.ok ? workingFrom(r.value) : null)).catch(() => null) : Promise.resolve(null));
  const resultsAsked = early<ResultsView>(
    manages && outreachScreens() !== "off"
      ? (async () => {
          const r = await readResultsV6({ token, tenantId, userId }, rangeOf("week", Date.now()));
          const tr = appT(lang);
          return resultsView(r.counts, r.sources, (tag) => sourceNameOf((k, v) => tr(k as "frame.notyet", v), tag));
        })().catch((): ResultsView => ({ stages: [], costs: [] }))
      : Promise.resolve<ResultsView>({ stages: [], costs: [] }),
  );
  const band = early(
    (async (): Promise<V6Band> => {
      const [status, choice, profile] = await Promise.all([readAssistantStatus(token, tenantId), readChoice(tenantId), profileAsked]);
      const missing = (await missingFor(status, shop)) ?? [];
      // an assistant whose status cannot be known is taken as live: no checklist is drawn on a guess
      const isLive = status === null || status.state === "live";
      const checklist = showChecklist({ live: isLive, choice, reopen: setup === "1", manages });
      const wantDone = status !== null && manages && (checklist || choice !== "dismissed");
      const done = wantDone && status ? await readDone(token, tenantId, shop, modules, status, missing) : null;
      const steps = done ? stepViews(done, base, modules.includes("catalogue")) : null;
      const count = steps ? doneCount(steps) : 0;
      const dayOne: DayOneIn | null =
        checklist && steps
          ? {
              name: (await userName) ?? shop,
              steps,
              canGoLive: missing.length === 0,
              missing: missing.filter((m): m is "business_name" | "phone_number" => m === "business_name" || m === "phone_number"),
              actions: { skip: skipSetupAction.bind(null, tenantId), goLive: goLiveAction.bind(null, tenantId), testNumber: manages && assistantStatusScreens() === "mock" ? testNumberAction.bind(null, tenantId) : null },
              helpHref: "/app/support/whatsapp?page=today",
              testCallHref: `${base}/calls`,
              ...(firstDayOpen() ? { open: true } : {}),
            }
          : null;
      const chip: ReactNode = steps && showChip({ done: count, choice, checklistShown: checklist, manages }) ? <FinishChip done={count} base={base} words={words} dismiss={dismissChipAction.bind(null, tenantId)} /> : null;
      const mockOn = callMode === "mock";
      const calls = await callsAsked;
      return {
        words,
        language: LANGUAGE_NAMES[lang].native,
        businessLang: businessLanguage(profile?.languages ?? []),
        shop,
        liveCalls: calls ? calls.live : [],
        mockLive: mockOn && live === "1" ? { caller: MOCK_CALL.callee } : null,
        demoCall: manages && demoCall() && (await readIsDemo(token, tenantId, shop)) ? { start: startDemoCallAction.bind(null, tenantId), end: endDemoCallAction.bind(null, tenantId) } : null,
        dayOne,
        chip,
        ...(todayOpen() ? { open: true } : {}),
      };
    })(),
  );
  const lower = early(
    (async (): Promise<V6Lower> => {
      const calls = await callsAsked;
      return { working: await workingAsked, results: await resultsAsked, dayCalls: calls ? calls.times : null, dayTransferred: calls ? calls.transferred : null };
    })(),
  );
  // JOBS: "Running now" under Needs you (null when JOBS is off or the API has no jobs yet); asked at once with the rest, and a read that fails draws nothing
  const jobs = early(
    Promise.all([readJobsToday(token, tenantId), manages ? readFestivals(token, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)) : Promise.resolve(null)])
      .then(([r, festivals]): ReactNode => {
        const list = r?.jobs ?? null;
        // "New job" (the sheet) and the festival suggestion are the Owner's and an Admin's; the sheet's own code is a lazy chunk, so Today ships only the button
        const sheet = manages ? { actions: { plan: planJobAction.bind(null, tenantId), start: startPlanAction.bind(null, tenantId), test: testPlanAction.bind(null, tenantId), search: changeSearchAction.bind(null, tenantId), load: loadNewJobSheetAction.bind(null, tenantId) }, festival: festivalHint(festivals, lang, new Date()) } : null;
        // an own message WhatsApp sent back is one row that opens Chats > Templates (Owner and Admin: only they can change it)
        const messagesToChange = manages ? (r?.needsYou ?? []).filter((n) => n.code === "message_needs_change" && n.target.type === "message").length : 0;
        if (!list || list.length === 0) return null;
        const words = wordsFor(lang, ["jobs."]);
        const section = <JobsToday jobs={list} words={words} base={base} actions={manages ? { setEnabled: setJobEnabledAction.bind(null, tenantId) } : null} sheet={sheet} messagesToChange={messagesToChange} open={todayOpen()} />;
        // the staging preview, "my business" (lib/screens/preview.ts): jobs drawn from the sample data (the route is not there yet) say so
        return list.some((j) => j.sample) ? (
          <>
            <p data-part="sample-today" className="m-0 mb-2">
              <SampleChip words={words} note />
            </p>
            {section}
          </>
        ) : (
          section
        );
      })
      .catch((e): ReactNode => (e instanceof ApiAuthError ? Promise.reject(e) : null)),
  );
  return { band, lower, jobs };
}

/** The two parts together, for a caller that wants Today's whole v6 input at once (the tests of it, the pages that wait for everything). */
export async function readV6(args: V6Args): Promise<V6In | null> {
  const started = startV6(args);
  if (!started) return null;
  const [band, lower, jobs] = await Promise.all([started.band, started.lower, started.jobs]);
  return { ...band, ...lower, jobs };
}
