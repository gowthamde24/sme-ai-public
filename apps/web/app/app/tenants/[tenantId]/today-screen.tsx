import { redirect } from "next/navigation";

import { TodayView } from "@/components/v2/app/today/TodayView";
import type { TodayActions } from "@/components/v2/app/today/actions-types";
import type { Role } from "@/components/v2/app/today/types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { pageMain } from "@/components/v2/app/ui";

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
export async function TodayScreen({ accessToken, userId, tenantId, role, shop = "" }: { accessToken: string; userId: string; tenantId: string; role: Role; /** The business's name (the setup wizard greets it). */ shop?: string }) {
  const lang = await getLang();
  const t = appT(lang);
  const now = clock();
  let data, name, setup = null;
  try {
    // the Owner of a workspace that is not set up yet sees the setup wizard / checklist (job BJ): its facts are read here, with existing endpoints only
    [data, name, setup] = await Promise.all([readToday(accessToken, tenantId, role), readDisplayName(accessToken, tenantId, userId), role === "owner" ? readSetupFacts(accessToken, tenantId, shop) : Promise.resolve(null)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
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
  return (
    <main className={pageMain} lang={lang}>
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
