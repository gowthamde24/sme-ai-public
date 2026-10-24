import { notFound, redirect } from "next/navigation";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { isDay, todayInIndia } from "@/components/v2/app/visits/dates";
import type { VisitsActions } from "@/components/v2/app/visits/actions-types";
import { VisitsView } from "@/components/v2/app/visits/VisitsView";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { arriveVisitAction, bookVisitAction, cancelVisitAction, completeVisitAction, confirmVisitAction, customersAction, moveVisitAction, noShowVisitAction, saveHoursAction, slotsAction } from "./visits-actions";
import { readDay, readHours, readLeadLabel, readVisit } from "./visits-data";
import { visitsWords } from "./visits-words";
import { withModuleWords } from "@/lib/packs/module-words";
import { readPackCached } from "@/lib/packs/read";
import { partsWords } from "@/i18n/app-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Store visits · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The moment the page is drawn (ms): read here, once, so the day and the buttons that depend on the time agree. */
const clock = (): number => Date.now();

/**
 * /app/tenants/[tenantId]/visits: who is coming to the shop. A day at a time (today unless `?date=`), the visits of the day with the buttons for each step, the free times and "Book a visit"; the
 * second tab holds the store hours. `?lead=` opens the booking for that lead (from its page), `?time=` picks one of the free times, `?visit=` opens the day of that visit (the Ask box's link).
 * Every member reads; a Viewer sees no buttons; the hours are the Owner's and Admin's. Server side: requireUser() runs first and every call goes to OUR API with the person's own token.
 */
export default async function VisitsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/visits">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const pack = await readPackCached(user.accessToken, tenantId).catch(() => null);
  const now = clock();
  const today = todayInIndia(now);
  const view = pick(query.view) === "hours" ? "hours" : "day";

  let day = isDay(pick(query.date)) ? (pick(query.date) as string) : today;
  const wantedVisit = pick(query.visit);
  let focus: string | null = null;
  let data;
  let hours = null;
  let lead = null;
  try {
    if (wantedVisit && !isDay(pick(query.date))) {
      const v = await readVisit(user.accessToken, tenantId, wantedVisit);
      if (v) {
        day = v.date;
        focus = v.id;
      }
    }
    const leadParam = pick(query.lead);
    [data, hours, lead] = await Promise.all([
      view === "day" ? readDay(user.accessToken, tenantId, day) : Promise.resolve({ visits: null, slots: null }),
      view === "hours" ? readHours(user.accessToken, tenantId) : Promise.resolve(null),
      leadParam ? readLeadLabel(user.accessToken, tenantId, leadParam) : Promise.resolve(null),
    ]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const actions: VisitsActions = {
    book: bookVisitAction.bind(null, tenantId),
    move: moveVisitAction.bind(null, tenantId),
    confirm: confirmVisitAction.bind(null, tenantId),
    arrive: arriveVisitAction.bind(null, tenantId),
    noShow: noShowVisitAction.bind(null, tenantId),
    cancel: cancelVisitAction.bind(null, tenantId),
    complete: completeVisitAction.bind(null, tenantId),
    slots: slotsAction.bind(null, tenantId),
    customers: customersAction.bind(null, tenantId),
    saveHours: saveHoursAction.bind(null, tenantId),
  };
  const time = pick(query.time);
  return (
    <main className={pageMain} lang={lang}>
      <VisitsView
        help={helpTipFor(lang, `/app/tenants/${tenantId}`, "visits")}
        view={view}
        day={day}
        today={today}
        now={now}
        lang={lang}
        role={tenant.role}
        base={`/app/tenants/${tenantId}`}
        words={withModuleWords(visitsWords(lang), pack)}
        visits={data.visits}
        slots={data.slots}
        hours={hours}
        actions={actions}
        lead={lead}
        time={time && CLOCK.test(time) ? time : null}
        focus={focus}
      />
    </main>
  );
}
