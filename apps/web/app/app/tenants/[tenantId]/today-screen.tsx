import { redirect } from "next/navigation";

import { todayChips, type ChipKey } from "@/components/v2/app/today/ask/ask-chips";
import { TodayView } from "@/components/v2/app/today/TodayView";
import type { TodayActions } from "@/components/v2/app/today/actions-types";
import type { Role, T } from "@/components/v2/app/today/types";
import { appDict, appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { pageMain } from "@/components/v2/app/ui";
import { ActivationCard } from "@/components/v2/app/start/ActivationCard";
import { ExampleBanner, type ExampleNotice } from "@/components/v2/app/start/ExampleBanner";
import { readActivation, stepChecks, usesChecklist, type Activation } from "@/lib/packs/activation";
import { readHidden, withoutHidden } from "@/lib/packs/hidden-steps";
import { setStepHiddenAction } from "./start-hide-actions";
import { leadDeskSteps } from "@/lib/packs/lead-activation";
import { getExampleStatus } from "@/lib/api/example-data";
import { readPackCached } from "@/lib/packs/read";
import { readIsDemo } from "./today-read";
import { readPackCards } from "@/lib/packs/pack-cards";
import { LiveNowCard } from "@/components/v2/app/call/LiveNowCard";
import { MOCK_CALL } from "@/lib/calls/mock";
import { LANGUAGE_NAMES } from "@/i18n/lang";
import { aiTeamScreens, appV4, assistantWorkScreens, callScreens, leadsScreens, outcomeScreens, outreachScreens, taskScreens } from "@/lib/screens/flag";
import { primeTodaySummary, summaryInclude, summarySkip } from "@/lib/api/today-summary";

import { planOrReport, todayHero } from "./today-hero";
import { OutcomesToday } from "@/components/v2/app/outcomes/OutcomesToday";
import { wordsFor } from "@/i18n/app-words";
import { readOutcomeTotals } from "@/lib/outcomes/source";
import { getNavCounts } from "@/lib/api/nav-counts";
import { formatRupeesShort } from "@/lib/money";
import { withModuleT } from "@/lib/packs/module-words";
import { withPackT } from "@/lib/packs/resolve";
import { withVisitWords } from "@/lib/packs/visit-words";
import { loadExampleAction, removeExampleAction, resetExampleAction } from "./start/actions";

import { approveCallAction, approveMessageAction, callHandledAction, callProspectAction, editMessageAction, offerVisitAction, rejectMessageAction, skipProspectAction } from "./today-actions";
import { SetupGate } from "@/components/v2/app/setup/SetupGate";
import type { SetupActions } from "@/components/v2/app/setup/types";
import { saveItemAction } from "./catalogue/catalogue-actions";
import { readSetupFacts } from "./setup-data";
import { topupsToday } from "./topups-today";
import { setupWords } from "./setup-words";
import { readLeadDesk, sourceNameOf } from "./lead-desk-today";
import { finderUpsellCard, readFinderNeeds } from "./lead-finder-today";
import { readFinderAccessCached } from "../../frame-data";
import { upgradeHref } from "@/lib/plan/tier-source";
import { audienceModules, withFinder } from "@/lib/lead-finder/types";
import { readTemplates } from "@/lib/lead-desk/source";
import { mergeDesk, readDisplayName, readToday } from "./today-data";
import { standupToday } from "./ai-team/standup-today";
import { cancelVisitAction, confirmVisitAction, moveVisitAction, saveHoursAction, slotsAction } from "./visits/visits-actions";

/** The hour in India, where the business is: the greeting does not depend on the server's clock zone. */
function hourInIndia(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
}

/** Starts a read NOW and hands the promise on: a rejection that arrives while the page is still waiting for something else is not lost (the same promise is awaited where it is used, and raises there). */
const early = <V,>(promise: Promise<V>): Promise<V> => {
  promise.catch(() => undefined);
  return promise;
};

/** The moment the screen is drawn (ms): read here, once, so the greeting, the date and the times on the cards agree. */
const clock = (): number => Date.now();

/** The default screen of a workspace (the home with no `?tab=`): Today. The records tables are Customers and Leads (`?tab=`). Server side; the page has already run requireUser and fetchTenant. */
export async function TodayScreen({ accessToken, userId, tenantId, role, shop = "", example = null, kept = 0 }: { accessToken: string; userId: string; tenantId: string; role: Role; /** The business's name (the setup wizard greets it). */ shop?: string; /** The result of the last "example data" press (carried in the address by the action; job CL). */ example?: string | null; /** Sample rows that stayed because they were used (with `example=removed`). */ kept?: number }) {
  // the reads that need nothing of each other start together: the language, the business type, the Lead Finder's access and the list of lead templates (they were awaited one after another: about three round trips before the page could start)
  const templatesAsked = early(readTemplates());
  const finderAsked = early(role === "viewer" ? Promise.resolve(null) : readFinderAccessCached(accessToken, tenantId).catch(() => null));
  const [lang, pack] = await Promise.all([getLang(), readPackCached(accessToken, tenantId)]);
  // the business type (job CL): once per request (the frame asked already). Its own words (the helpers' names) go on top of the dictionary; a business type with a checklist of its own shows it instead of the first-run wizard
  // a business's own word for a visit (Site visit, Campus visit, Test drive ...) where the screens said "store" (C1 #308)
  const packT = pack ? withVisitWords(withPackT(withModuleT(appT(lang), pack, appDict(lang)), pack, lang), pack, lang) : appT(lang);
  // a school's Lead Finder finds organisations (C1, 5 Nov): its rows and its one upsell row say so (`key@organisations`), never retailers
  const finderAccessNow = await finderAsked;
  const finderAudience = finderAccessNow?.audience ?? "businesses";
  const t = withModuleT(packT, audienceModules(finderAudience), appDict(lang));
  const now = clock();
  let data, name, setup = null, activation: Activation | null = null, sample = null, packCards: Awaited<ReturnType<typeof readPackCards>> = [];
  let chipKeys: readonly ChipKey[] | null = null;
  let newLeads: number | null = null;
  const base = `/app/tenants/${tenantId}`;
  const manages = role === "owner" || role === "admin";
  const ownSteps = manages && usesChecklist(pack);
  const tt: T = (key, vars) => t(key as "frame.notyet", vars);
  // does this business type have a lead template (the API's own list)? Only then does "Your team" show the Lead Desk workers (and are the leads read for it)
  const deskPack = pack ? (await templatesAsked).some((x) => x.packId === pack.packId) : false;
  // TODAY_SUMMARY_SCREENS=1: the page body's reads are asked of the API in ONE request (lib/api/today-summary.ts): the default sections minus what this page will not draw for this role and these flags, plus the opt-in ones this business type's own cards and checklist need (`include=`, `checks=`). The readers below are answered from it.
  const leadSteps = ownSteps && pack ? await leadDeskSteps(pack, deskPack) : [];
  const checks = ownSteps && pack ? stepChecks(pack.modules, leadSteps) : [];
  primeTodaySummary(accessToken, tenantId, summarySkip({ role, finderOn: role !== "viewer" && finderAccessNow?.access === "on", outreachOn: outreachScreens() === "on", tasksOn: taskScreens() === "on", leadsOn: leadsScreens() === "on" }), { include: summaryInclude({ role, modules: pack?.modules ?? null, checks, outcomesOn: outcomeScreens() === "on" }), checks });
  // These four do not wait for the page's data: they start NOW, with the big read below, and are awaited where they are drawn (Today made them one after another after it: staging, 12 Nov 2026, about four extra round trips before the first byte of the page).
  // A rejection that arrives while the page is still waiting for something else is not lost: the same promise is awaited below (and raises there).
  const totalsAsked = early(role === "viewer" ? Promise.resolve({ mode: "off" } as const) : readOutcomeTotals({ token: accessToken, tenantId }));
  const standupAsked = early(manages && aiTeamScreens() !== "off" ? standupToday(tenantId, lang) : Promise.resolve(null));
  const topupsAsked = early(manages ? topupsToday({ token: accessToken, tenantId, lang, owner: role === "owner" }) : Promise.resolve(null));
  const demoAsked = early(readIsDemo(accessToken, tenantId, shop));
  try {
    // the Owner of a workspace that is not set up yet sees the setup wizard / checklist (job BJ): its facts are read here, with existing endpoints only
    // what Lead Desk adds (hot leads, plans waiting, callbacks due, limits reached) joins "Needs you" in any workspace; its workers replace the shop's helpers only in a business type that has a lead template (the API's own list: no type is named here)
    let desk: Awaited<ReturnType<typeof readLeadDesk>>;
    let finder: Awaited<ReturnType<typeof readFinderNeeds>>;
    let counts: Awaited<ReturnType<typeof getNavCounts>> | null;
    [data, name, setup, activation, sample, packCards, desk, finder, counts] = await Promise.all([
      readToday(accessToken, tenantId, role),
      readDisplayName(accessToken, tenantId, userId),
      role === "owner" && !usesChecklist(pack) ? readSetupFacts(accessToken, tenantId, shop) : Promise.resolve(null),
      ownSteps && pack ? readActivation(accessToken, tenantId, pack, t, leadSteps) : Promise.resolve(null),
      manages && pack ? getExampleStatus(accessToken, tenantId) : Promise.resolve(null),
      readPackCards({ accessToken, tenantId, role, pack, now, formatMoney: formatRupeesShort }),
      readLeadDesk({ token: accessToken, tenantId, userId }, role, base, tt, (tag) => sourceNameOf(tt, tag), now, deskPack),
      // the Lead Finder's businesses that need a person (only where the Lead Finder is available: the frame's answer, read once per request; one that cannot be told adds nothing)
      role === "viewer" ? Promise.resolve([]) : readFinderAccessCached(accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)).then((a) => readFinderNeeds({ token: accessToken, tenantId }, role, a?.access ?? null, base, tt)),
      // the menu's numbers (C1's nav-counts, cached 30 s by the API): Today's New leads card when the workspace has no Lead Desk; one that cannot be read is no card
      getNavCounts(accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)),
    ]);
    newLeads = counts?.newLeads ?? null;
    // the steps the person put away from Today (a cookie of this browser) are not drawn; they stay in Settings
    if (activation) activation = withoutHidden(activation, await readHidden(tenantId));
    // Lead Desk's items and workers join what the API said (the merge keeps one card per thing and counts only what the API did not)
    data = mergeDesk(data, { needs: [...desk.needs, ...finder], team: deskPack ? desk.team : [] });
    // a business whose own card counts its visits (a school's "Campus visits today") does not also get the shop's "At the store today" (owner, 4 Nov: no shop words for a school)
    if (packCards.some((c) => c.id === "campus")) data = { ...data, store: null };
    // the Lead Finder is named in "Your team" exactly where its own API says it is available and the plan has it (C1, 4 Nov): the helpers' status may still say "not built" for it
    const finderAccess = (await readFinderAccessCached(accessToken, tenantId).catch(() => null))?.access ?? "hidden";
    chipKeys = todayChips({ finder: finderAccess === "on" && role !== "viewer", files: assistantWorkScreens(tenantId) !== "off" && role !== "viewer" });
    data = { ...data, team: withFinder(data.team, finderAccess === "on") };
    // a Lead Desk plan (owner decision 4 Nov): one short "part of AI Workforce" row instead of the Lead Finder's rows, at the end and not counted as waiting
    const upsell = finderAccess === "upsell" && data.needs !== null ? finderUpsellCard(role, upgradeHref(base, role), tt, new Date(now).toISOString()) : null;
    if (upsell && data.needs) data = { ...data, needs: [...data.needs, upsell] };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  // the decisions on the cards: server actions bound to this workspace (the browser never holds the token)
  const actions: TodayActions = {
    approveMessage: approveMessageAction.bind(null, tenantId),
    rejectMessage: rejectMessageAction.bind(null, tenantId),
    editMessage: editMessageAction.bind(null, tenantId),
    approveCall: approveCallAction.bind(null, tenantId),
    offerVisit: offerVisitAction.bind(null, tenantId),
    callHandled: callHandledAction.bind(null, tenantId),
    visit: { confirm: confirmVisitAction.bind(null, tenantId), move: moveVisitAction.bind(null, tenantId), cancel: cancelVisitAction.bind(null, tenantId), slots: slotsAction.bind(null, tenantId) },
    // the Lead Finder's rows: Owner, Admin and Sales act on prospects (a Viewer is never shown them)
    prospect: role === "viewer" ? null : { call: callProspectAction.bind(null, tenantId), skip: skipProspectAction.bind(null, tenantId) },
  };
  // today's totals of what happened after the calls and follow-ups (job DM): drawn only when the flag is on (OUTCOME_SCREENS); a role that is not Owner, Admin or Sales does not see them
  const totals = await totalsAsked;
  // totals that cannot be read are not drawn (owner's review, 5 Nov: Today never says "Not available yet")
  const outcomes = totals.mode === "ok" ? <OutcomesToday words={wordsFor(lang, ["outcome.today."], ["frame.notyet"])} totals={totals.data} /> : null;
  // "Live now" (job DM): a call that is going on. There is no telephony yet, so only the pretend call of CALL_SCREENS=mock is ever shown; nothing is drawn with the flag off
  const live = callScreens() === "mock" && role !== "viewer" ? <LiveNowCard words={wordsFor(lang, ["call.now."])} callee={MOCK_CALL.callee} info={`${t(`call.kind.${MOCK_CALL.kind}` as "call.kind.followup")} · ${LANGUAGE_NAMES[MOCK_CALL.lang].native}`} href={`/app/tenants/${tenantId}/office/live`} /> : null;
  // the daily stand-up (job ai-team-v2): Owner and Admin, with My AI team v2 on; one that cannot be read is simply not drawn
  const [standup, topups, demo] = await Promise.all([standupAsked, topupsAsked, demoAsked]);
  // app v4 (APP_V4): the hero above the composer (part 2), from the real data read above
  const hero = appV4() ? await todayHero({ token: accessToken, tenantId, lang, data, totals, role }) : null;
  const plan = appV4() ? planOrReport({ tenantId, lang, data, hour: hourInIndia(), standup: manages && aiTeamScreens() !== "off" }) : null;
  // the "example data" banner (blueprint 3.2) is the first-run offer of a workspace made with a chosen business type; a workspace that existed before business types sees it only while a sample is loaded (so it can be removed)
  const showSample = sample !== null && (sample.loaded || (usesChecklist(pack) && pack?.hasExampleData !== false));
  const notice: ExampleNotice = example === "loaded" || example === "removed" || example === "reset" || example === "unavailable" || example === "failed" ? example : null;
  // the example-data notice is ONE slim line under the greeting; "Finish setting up" comes under the cards (owner review, 1 Nov): what needs the person is the first thing on Today, whatever the workspace's age
  const exampleLine = showSample && sample ? <ExampleBanner state={sample.loaded ? "loaded" : "available"} notice={notice} kept={kept} load={loadExampleAction.bind(null, tenantId)} remove={removeExampleAction.bind(null, tenantId)} reset={resetExampleAction.bind(null, tenantId)} t={t} /> : null;
  const intro = activation && activation.done < activation.total ? <div data-part="start"><ActivationCard collapse activation={activation} base={`/app/tenants/${tenantId}`} t={t} hide={setStepHiddenAction.bind(null, tenantId)} /></div> : null;
  const view = (
      <TodayView hero={hero} plan={plan} chipKeys={chipKeys} demo={demo} exampleLine={exampleLine} intro={intro} live={live || standup ? <>{live}{standup}</> : null} outcomes={outcomes} packCards={packCards} newLeads={newLeads} hasOrders={!pack || pack.modules.includes("orders")} help={helpTipFor(lang, `/app/tenants/${tenantId}`, "today")} data={data} name={name} hour={hourInIndia(new Date(now))} now={now} base={`/app/tenants/${tenantId}`} t={(key, vars) => t(key as "frame.notyet", vars)} lang={lang} role={role} actions={actions} outboxHref={role === "viewer" ? null : `/app/tenants/${tenantId}/outbox?tab=sent`} />
  );
  const setupActions: SetupActions = { saveHours: saveHoursAction.bind(null, tenantId), saveItem: saveItemAction.bind(null, tenantId) };
  return (
    <main className={pageMain} lang={lang}>
      {topups}
      {setup ? (
        <SetupGate tenantId={tenantId} base={`/app/tenants/${tenantId}`} lang={lang} facts={setup} words={setupWords(lang)} actions={setupActions} slim={appV4()}>
          {view}
        </SetupGate>
      ) : (
        view
      )}
    </main>
  );
}
