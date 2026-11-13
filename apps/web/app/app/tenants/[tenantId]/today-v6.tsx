import { type ReactNode } from "react";

import { FinishChip } from "@/components/v2/app/today/v6/day-one/FinishChip";
import { doneCount, showChecklist, showChip, stepViews, type StepId } from "@/components/v2/app/today/v6/day-one/steps";
import type { DayOneIn, V6In } from "@/components/v2/app/today/v6/types";
import { wordsFor } from "@/i18n/app-words";
import { LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { ApiAuthError } from "@/lib/api/client";
import { listCalls } from "@/lib/api/calls";
import { getProfile } from "@/lib/api/profile";
import { workingFrom, type Working } from "@/components/v2/app/today/v6/lower-data";
import { resultsView, type ResultsView } from "@/components/v2/app/today/v6/results-data";
import { appT } from "@/i18n/app";
import { rangeOf } from "@/lib/reports-v6/results";
import { readTasks } from "@/lib/tasks/source";
import { sourceNameOf } from "./lead-desk-today";
import { MOCK_CALL } from "@/lib/calls/mock";
import { hasOwnName, missingFor } from "@/lib/assistant-status/go-live";
import { readAssistantStatus } from "@/lib/assistant-status/source";
import { readChoice } from "@/lib/assistant-status/setup-choice";
import type { StepCheck } from "@/lib/packs/activation";
import { readFacts } from "@/lib/packs/activation-facts";
import { assistantStatusScreens, callScreens, designV6, outreachScreens, taskScreens } from "@/lib/screens/flag";
import { readResultsV6 } from "./report/v6-data";

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

/** Today's calls (their start times), from the calls list; a read that fails, or takes longer than 1.5 s, is "not known" (Today never waits for it). The list is the API's newest page: with more calls than a page holds the day shows the newest. */
async function readDayCalls(token: string, tenantId: string): Promise<string[] | null> {
  try {
    const page = await Promise.race([listCalls(token, tenantId), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))]);
    return page ? page.items.filter((c) => !c.sandbox).map((c) => c.createdAt) : null;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** The seven steps of day one, done or not, from what can be read. A fact that cannot be read is "not done". "Practise" has no fact yet (C1's onboarding progress is still to build). */
async function readDone(token: string, tenantId: string, shop: string, modules: readonly string[], status: NonNullable<Awaited<ReturnType<typeof readAssistantStatus>>>, missing: readonly string[]): Promise<Partial<Record<StepId, boolean>>> {
  const facts: Partial<Record<StepCheck, boolean>> = await readFacts(token, tenantId, ["catalogue_has_items", "lead_source_added"], modules).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : {}));
  return {
    shop: hasOwnName(shop),
    catalogue: facts.catalogue_has_items === true,
    speaks: !status.usingDefaults.includes("voice"),
    rules: !status.usingDefaults.includes("rules"),
    practise: false,
    phone: !missing.includes("phone_number"),
    sources: facts.lead_source_added === true,
  };
}

/**
 * Everything the page gives Today for the design system v6 (null where DESIGN_V6 is off): the words, the business name and language, today's calls (for "Your day"), the approved job, this week's results, and the day one checklist (until the assistant is live, unless skipped) or the "Finish setup" chip.
 * The calls flag `mock` makes pretend calls for the timeline, and `?live=1` a pretend live call (staging); with the real API the calls are read from the calls list and a live call comes from the live-call poll in the browser.
 */
export async function readV6({ token, tenantId, userId = "", role, lang, shop, userName, modules, setup, live, base }: { token: string; tenantId: string; userId?: string; role: "owner" | "admin" | "sales" | "viewer"; lang: Lang; shop: string; userName: string | null; modules: readonly string[]; /** `?setup=1`: the chip's link reopens the checklist. */ setup: string | null; /** `?live=1`: the pretend live call (CALL_SCREENS=mock only). */ live: string | null; base: string }): Promise<V6In | null> {
  if (!designV6()) return null;
  const manages = role === "owner" || role === "admin";
  const words = wordsFor(lang, ["tv6.", "dst."]);
  const callMode = callScreens();
  const callsAsked = early<string[] | null>(callMode === "mock" ? Promise.resolve(mockCallTimes(Date.now())) : callMode === "on" && (manages || role === "sales") ? readDayCalls(token, tenantId) : Promise.resolve(null));
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
  const [status, choice, profile] = await Promise.all([readAssistantStatus(token, tenantId), readChoice(tenantId), profileAsked]);
  const missing = (await missingFor(status, shop)) ?? [];
  // an assistant whose status cannot be known is taken as live: no checklist is drawn on a guess
  const isLive = status === null || status.state === "live";
  const checklist = showChecklist({ live: isLive, choice, reopen: setup === "1", manages });
  const wantDone = status !== null && manages && (checklist || choice !== "dismissed");
  const done = wantDone && status ? await readDone(token, tenantId, shop, modules, status, missing) : null;
  const steps = done ? stepViews(done, base) : null;
  const count = steps ? doneCount(steps) : 0;
  const dayOne: DayOneIn | null =
    checklist && steps
      ? {
          name: userName ?? shop,
          steps,
          canGoLive: missing.length === 0,
          missing: missing.filter((m): m is "business_name" | "phone_number" => m === "business_name" || m === "phone_number"),
          actions: { skip: skipSetupAction.bind(null, tenantId), goLive: goLiveAction.bind(null, tenantId), testNumber: manages && assistantStatusScreens() === "mock" ? testNumberAction.bind(null, tenantId) : null },
          helpHref: "/app/support/whatsapp?page=today",
          testCallHref: `${base}/calls`,
        }
      : null;
  const chip: ReactNode = steps && showChip({ done: count, choice, checklistShown: checklist, manages }) ? <FinishChip done={count} base={base} words={words} dismiss={dismissChipAction.bind(null, tenantId)} /> : null;
  const mockOn = callMode === "mock";
  return {
    words,
    language: LANGUAGE_NAMES[lang].native,
    businessLang: profile?.languages[0] ?? null,
    shop,
    working: await workingAsked,
    results: await resultsAsked,
    dayCalls: await callsAsked,
    mockLive: mockOn && live === "1" ? { caller: MOCK_CALL.callee } : null,
    dayOne,
    chip,
  };
}
