import { notFound, redirect } from "next/navigation";

import { TripBoard } from "@/components/v2/app/deliveries/TripBoard";
import { dayInIndia, isDay } from "@/components/v2/app/deliveries/trip-logic";
import { NotShownV2, ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { listTrips } from "@/lib/api/deliveries";
import { escalate } from "@/lib/api/failure";
import { listSites } from "@/lib/api/sites";
import { clock } from "@/lib/clock";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { notifyTripAction, setTripStatusAction } from "./trip-actions";
import { tripWords } from "./trip-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Deliveries · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /app/tenants/[tenantId]/orders/trips: the trips of a day on one board (job CO; module `deliveries`). Owner, Admin and Sales; a Viewer sees nothing. `?date=` moves the day. */
export default async function TripsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/orders/trips">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const raw = await searchParams;
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
  if (!hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "deliveries")) notFound();
  const lang = await getLang();
  const words = tripWords(lang);
  if (tenant.role === "viewer") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={words["trip.board.title"]} message={words["trip.viewer"]} />;
  const today = dayInIndia(clock());
  const wanted = pick(raw.date);
  const day = isDay(wanted) ? wanted : today;
  let trips = null;
  const sites: Record<string, string> = {};
  try {
    trips = (await listTrips(user.accessToken, tenantId, { date: day })).items;
    const page = await listSites(user.accessToken, tenantId, { includeInactive: true, limit: 100 }).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null));
    for (const s of page?.items ?? []) sites[s.id] = [s.name, s.city].filter(Boolean).join(", ");
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <TripBoard
        base={`/app/tenants/${tenantId}`}
        words={words}
        role={tenant.role}
        day={day}
        today={today}
        trips={trips}
        sites={sites}
        saved={pick(raw.saved) === "1"}
        actions={{ setStatus: setTripStatusAction.bind(null, tenantId), notify: notifyTripAction.bind(null, tenantId) }}
      />
    </main>
  );
}
