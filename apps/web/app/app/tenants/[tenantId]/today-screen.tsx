import { redirect } from "next/navigation";

import { TodayView } from "@/components/v2/app/today/TodayView";
import type { TodayActions } from "@/components/v2/app/today/actions-types";
import type { Role } from "@/components/v2/app/today/types";
import { appDict, appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { pageMain } from "@/components/v2/app/ui";
import { ActivationCard } from "@/components/v2/app/start/ActivationCard";
import { ExampleBanner, type ExampleNotice } from "@/components/v2/app/start/ExampleBanner";
import { readActivation, usesChecklist, type Activation } from "@/lib/packs/activation";
import { getExampleStatus } from "@/lib/api/example-data";
import { readPackCached } from "@/lib/packs/read";
import { readIsDemo } from "./today-read";
import { readPackCards } from "@/lib/packs/pack-cards";
import { PackCards } from "@/components/v2/app/today/PackCards";
import { LiveNowCard } from "@/components/v2/app/call/LiveNowCard";
import { MOCK_CALL } from "@/lib/calls/mock";
import { LANGUAGE_NAMES } from "@/i18n/lang";
import { callScreens } from "@/lib/screens/flag";
import { OutcomesToday } from "@/components/v2/app/outcomes/OutcomesToday";
import { wordsFor } from "@/i18n/app-words";
import { readOutcomeTotals } from "@/lib/outcomes/source";
import { formatRupees } from "@/lib/money";
import { withModuleT } from "@/lib/packs/module-words";
import { withPackT } from "@/lib/packs/resolve";
import { loadExampleAction, removeExampleAction } from "./start/actions";

import { approveCallAction, approveMessageAction, editMessageAction, offerVisitAction, rejectMessageAction } from "./today-actions";
import { SetupGate } from "@/components/v2/app/setup/SetupGate";
import type { SetupActions } from "@/components/v2/app/setup/types";
import { saveItemAction } from "./catalogue/catalogue-actions";
import { readSetupFacts } from "./setup-data";
import { topupsToday } from "./topups-today";
import { setupWords } from "./setup-words";
import { readDisplayName, readToday } from "./today-data";
import { cancelVisitAction, confirmVisitAction, moveVisitAction, saveHoursAction, slotsAction } from "./visits/visits-actions";

/** The hour in India, where the business is: the greeting does not depend on the server's clock zone. */
function hourInIndia(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
}

/** The moment the screen is drawn (ms): read here, once, so the greeting, the date and the times on the cards agree. */
const clock = (): number => Date.now();

/** The default screen of a workspace (the home with no `?tab=`): Today. The records tables are Customers and Leads (`?tab=`). Server side; the page has already run requireUser and fetchTenant. */
export async function TodayScreen({ accessToken, userId, tenantId, role, shop = "", example = null, kept = 0 }: { accessToken: string; userId: string; tenantId: string; role: Role; /** The business's name (the setup wizard greets it). */ shop?: string; /** The result of the last "example data" press (carried in the address by the action; job CL). */ example?: string | null; /** Sample rows that stayed because they were used (with `example=removed`). */ kept?: number }) {
  const lang = await getLang();
  // the business type (job CL): once per request (the frame asked already). Its own words (the helpers' names) go on top of the dictionary; a business type with a checklist of its own shows it instead of the first-run wizard
  const pack = await readPackCached(accessToken, tenantId);
  const t = pack ? withPackT(withModuleT(appT(lang), pack, appDict(lang)), pack, lang) : appT(lang);
  const now = clock();
  let data, name, setup = null, activation: Activation | null = null, sample = null, packCards: Awaited<ReturnType<typeof readPackCards>> = [];
  const manages = role === "owner" || role === "admin";
  const ownSteps = manages && usesChecklist(pack);
  try {
    // the Owner of a workspace that is not set up yet sees the setup wizard / checklist (job BJ): its facts are read here, with existing endpoints only
    [data, name, setup, activation, sample, packCards] = await Promise.all([
      readToday(accessToken, tenantId, role),
      readDisplayName(accessToken, tenantId, userId),
      role === "owner" && !usesChecklist(pack) ? readSetupFacts(accessToken, tenantId, shop) : Promise.resolve(null),
      ownSteps && pack ? readActivation(accessToken, tenantId, pack, t) : Promise.resolve(null),
      manages && pack ? getExampleStatus(accessToken, tenantId) : Promise.resolve(null),
      readPackCards({ accessToken, tenantId, role, pack, now, formatMoney: formatRupees }),
    ]);
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
    visit: { confirm: confirmVisitAction.bind(null, tenantId), move: moveVisitAction.bind(null, tenantId), cancel: cancelVisitAction.bind(null, tenantId), slots: slotsAction.bind(null, tenantId) },
  };
  // today's totals of what happened after the calls and follow-ups (job DM): drawn only when the flag is on (OUTCOME_SCREENS); a role that is not Owner, Admin or Sales does not see them
  const totals = role === "viewer" ? ({ mode: "off" } as const) : await readOutcomeTotals({ token: accessToken, tenantId });
  const outcomes = totals.mode === "off" ? null : <OutcomesToday words={wordsFor(lang, ["outcome.today."], ["frame.notyet"])} totals={totals.mode === "ok" ? totals.data : null} />;
  // "Live now" (job DM): a call that is going on. There is no telephony yet, so only the pretend call of CALL_SCREENS=mock is ever shown; nothing is drawn with the flag off
  const live = callScreens() === "mock" && role !== "viewer" ? <LiveNowCard words={wordsFor(lang, ["call.now."])} callee={MOCK_CALL.callee} info={`${t(`call.kind.${MOCK_CALL.kind}` as "call.kind.followup")} · ${LANGUAGE_NAMES[MOCK_CALL.lang].native}`} href={`/app/tenants/${tenantId}/office/live`} /> : null;
  const topups = manages ? await topupsToday({ token: accessToken, tenantId, lang, owner: role === "owner" }) : null;
  const demo = await readIsDemo(accessToken, tenantId, shop);
  const view = (
      <TodayView demo={demo} live={live} outcomes={outcomes} packCards={<PackCards cards={packCards} t={(key, vars) => t(key as "frame.notyet", vars)} />} help={helpTipFor(lang, `/app/tenants/${tenantId}`, "today")} data={data} name={name} hour={hourInIndia(new Date(now))} now={now} base={`/app/tenants/${tenantId}`} t={(key, vars) => t(key as "frame.notyet", vars)} lang={lang} role={role} actions={actions} outboxHref={role === "viewer" ? null : `/app/tenants/${tenantId}/outbox?tab=sent`} />
  );
  const setupActions: SetupActions = { saveHours: saveHoursAction.bind(null, tenantId), saveItem: saveItemAction.bind(null, tenantId) };
  // the "example data" banner (blueprint 3.2) is the first-run offer of a workspace made with a chosen business type; a workspace that existed before business types sees it only while a sample is loaded (so it can be removed)
  const showSample = sample !== null && (sample.loaded || usesChecklist(pack));
  const notice: ExampleNotice = example === "loaded" || example === "removed" || example === "unavailable" || example === "failed" ? example : null;
  return (
    <main className={pageMain} lang={lang}>
      {topups}
      {showSample || (activation && activation.done < activation.total) ? (
        <div data-part="start" className="mb-6 flex flex-col gap-4">
          {showSample && sample ? <ExampleBanner state={sample.loaded ? "loaded" : "available"} notice={notice} kept={kept} load={loadExampleAction.bind(null, tenantId)} remove={removeExampleAction.bind(null, tenantId)} t={t} /> : null}
          {activation ? <ActivationCard activation={activation} base={`/app/tenants/${tenantId}`} t={t} /> : null}
        </div>
      ) : null}
      {setup ? (
        <SetupGate tenantId={tenantId} base={`/app/tenants/${tenantId}`} lang={lang} facts={setup} words={setupWords(lang)} actions={setupActions}>
          {view}
        </SetupGate>
      ) : (
        view
      )}
    </main>
  );
}
