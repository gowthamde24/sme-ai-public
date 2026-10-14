import { redirect } from "next/navigation";

import { TodayView } from "@/components/v2/app/today/TodayView";
import type { TodayActions } from "@/components/v2/app/today/actions-types";
import type { Role } from "@/components/v2/app/today/types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { pageMain } from "@/components/v2/app/ui";
import { ActivationCard } from "@/components/v2/app/start/ActivationCard";
import { ExampleBanner, type ExampleNotice } from "@/components/v2/app/start/ExampleBanner";
import { readActivation, type Activation } from "@/lib/packs/activation";
import { readPackCached } from "@/lib/packs/read";
import { withPackT } from "@/lib/packs/resolve";
import { loadExampleAction, removeExampleAction } from "./start/actions";

import { approveCallAction, approveMessageAction, editMessageAction, offerVisitAction, rejectMessageAction } from "./today-actions";
import { SetupGate } from "@/components/v2/app/setup/SetupGate";
import type { SetupActions } from "@/components/v2/app/setup/types";
import { saveItemAction } from "./catalogue/catalogue-actions";
import { readSetupFacts } from "./setup-data";
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
export async function TodayScreen({ accessToken, userId, tenantId, role, shop = "", example = null }: { accessToken: string; userId: string; tenantId: string; role: Role; /** The business's name (the setup wizard greets it). */ shop?: string; /** The result of the last "example data" press (carried in the address by the action; job CL). */ example?: string | null }) {
  const lang = await getLang();
  // the business type (job CL): once per request (the frame asked already). Its own words (the helpers' names) go on top of the dictionary; a business type with a checklist of its own shows it instead of the first-run wizard
  const pack = await readPackCached(accessToken, tenantId);
  const t = withPackT(appT(lang), pack.def, lang);
  const now = clock();
  let data, name, setup = null, activation: Activation | null = null;
  const manages = role === "owner" || role === "admin";
  const ownSteps = manages && pack.def.activation.style === "steps";
  try {
    // the Owner of a workspace that is not set up yet sees the setup wizard / checklist (job BJ): its facts are read here, with existing endpoints only
    [data, name, setup, activation] = await Promise.all([readToday(accessToken, tenantId, role), readDisplayName(accessToken, tenantId, userId), role === "owner" && pack.def.activation.style === "classic" ? readSetupFacts(accessToken, tenantId, shop) : Promise.resolve(null), ownSteps ? readActivation(accessToken, tenantId, pack.def, lang) : Promise.resolve(null)]);
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
  const view = (
      <TodayView help={helpTipFor(lang, `/app/tenants/${tenantId}`, "today")} data={data} name={name} hour={hourInIndia(new Date(now))} now={now} base={`/app/tenants/${tenantId}`} t={(key, vars) => t(key as "frame.notyet", vars)} lang={lang} role={role} actions={actions} outboxHref={role === "viewer" ? null : `/app/tenants/${tenantId}/outbox?tab=sent`} />
  );
  const setupActions: SetupActions = { saveHours: saveHoursAction.bind(null, tenantId), saveItem: saveItemAction.bind(null, tenantId) };
  const notice: ExampleNotice = example === "loaded" || example === "removed" || example === "unavailable" || example === "failed" ? example : null;
  return (
    <main className={pageMain} lang={lang}>
      {(manages && pack.example !== "none") || (activation && activation.done < activation.total) ? (
        <div data-part="start" className="mb-6 flex flex-col gap-4">
          {manages ? <ExampleBanner state={pack.example} notice={notice} load={loadExampleAction.bind(null, tenantId)} remove={removeExampleAction.bind(null, tenantId)} t={t} /> : null}
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
