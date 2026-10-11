import { redirect } from "next/navigation";

import { TodayView } from "@/components/v2/app/today/TodayView";
import type { TodayActions } from "@/components/v2/app/today/actions-types";
import type { Role } from "@/components/v2/app/today/types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { pageMain } from "@/components/v2/app/ui";

import { approveCallAction, approveMessageAction, editMessageAction, offerVisitAction, rejectMessageAction } from "./today-actions";
import { readDisplayName, readToday } from "./today-data";

/** The hour in India, where the business is: the greeting does not depend on the server's clock zone. */
function hourInIndia(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
}

/** The moment the screen is drawn (ms): read here, once, so the greeting, the date and the times on the cards agree. */
const clock = (): number => Date.now();

/** The default screen of a workspace (the home with no `?tab=`): Today. The records tables are Customers and Leads (`?tab=`). Server side; the page has already run requireUser and fetchTenant. */
export async function TodayScreen({ accessToken, userId, tenantId, role }: { accessToken: string; userId: string; tenantId: string; role: Role }) {
  const lang = await getLang();
  const t = appT(lang);
  const now = clock();
  let data, name;
  try {
    [data, name] = await Promise.all([readToday(accessToken, tenantId, role), readDisplayName(accessToken, tenantId, userId)]);
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
  };
  return (
    <main className={pageMain} lang={lang}>
      <TodayView data={data} name={name} hour={hourInIndia(new Date(now))} now={now} base={`/app/tenants/${tenantId}`} t={(key, vars) => t(key as "frame.notyet", vars)} lang={lang} role={role} actions={actions} />
    </main>
  );
}
