import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FreshPhotos } from "@/components/v2/app/catalogue/FreshPhotos";
import { Photo } from "@/components/v2/app/catalogue/Photo";
import { TripCard } from "@/components/v2/app/deliveries/TripCard";
import { TripForm } from "@/components/v2/app/deliveries/TripForm";
import { editable } from "@/components/v2/app/deliveries/trip-logic";
import { NotShownV2, ApiDownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getTrip } from "@/lib/api/deliveries";
import { escalate } from "@/lib/api/failure";
import { getSite } from "@/lib/api/sites";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { notifyTripAction, setTripStatusAction, updateTripAction } from "../trip-actions";
import { loadOrderTrips } from "../trip-data";
import { tripWords } from "../trip-words";

export const metadata = { title: "Trip · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** /app/tenants/[tenantId]/orders/trips/[tripId]: one trip (job CO): its card with the next steps, what happened to it, the proof of delivery and (while planned) the form to change it. Owner, Admin, Sales. */
export default async function TripPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/orders/trips/[tripId]">) {
  const user = await requireUser();
  const { tenantId, tripId } = await params;
  const raw = await searchParams;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(tripId)) notFound();
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
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role === "viewer") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={words["trip.board.title"]} message={words["trip.viewer"]} />;
  let trip;
  try {
    trip = await getTrip(user.accessToken, tenantId, tripId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const site = trip.site_id ? await getSite(user.accessToken, tenantId, trip.site_id).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  const wantsEdit = pick(raw.edit) === "1" && editable(trip.status);
  const data = wantsEdit ? await loadOrderTrips(user.accessToken, tenantId, trip.order_id, words["mat.unit.piece"], trip.id).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  return (
    <main className={pageMain} lang={lang}>
      <p><Link href={`${base}/orders/trips?date=${trip.planned_date}`} className={backLink}>← {words["trip.board.title"]}</Link></p>
      <div className="mt-3 flex flex-col gap-5">
        <ul>
          <TripCard trip={trip} base={base} siteLabel={site ? [site.name, site.city].filter(Boolean).join(", ") : null} words={words} role={tenant.role} actions={{ setStatus: setTripStatusAction.bind(null, tenantId), notify: notifyTripAction.bind(null, tenantId) }} uploadUrl={`${base}/orders/trips/${trip.id}/delivered`} />
        </ul>
        {trip.proof ? (
          <FreshPhotos seconds={trip.proof.expires_in_seconds}>
            <section aria-labelledby="proof" className="flex max-w-md flex-col gap-2">
              <h2 id="proof" className="font-display text-xl font-bold">{words["trip.proof.title"]}</h2>
              <Photo src={trip.proof.photo_url} width={trip.proof.width} height={trip.proof.height} alt={words["trip.proof.alt"]} words={words} shape="natural" />
              <p className="text-base">{(words["trip.proof.by"] ?? "").replace("{name}", trip.proof.received_by)}</p>
            </section>
          </FreshPhotos>
        ) : null}
        {trip.events.length > 0 ? (
          <section aria-labelledby="events" className="flex flex-col gap-2">
            <h2 id="events" className="font-display text-xl font-bold">{words["trip.events"]}</h2>
            <ol className="flex flex-col gap-1 text-base">
              {trip.events.map((e) => (
                <li key={e.seq}>{`${words[`trip.status.${e.to_status}`] ?? e.to_status} · ${e.recorded_at.slice(0, 16).replace("T", " ")}`}{e.problem_code ? `: ${words[`trip.problem.${e.problem_code}`] ?? ""}` : ""}</li>
              ))}
            </ol>
          </section>
        ) : null}
        {wantsEdit && data ? (
          <section aria-labelledby="edit" className="flex flex-col gap-3">
            <h2 id="edit" className="font-display text-xl font-bold">{words["trip.edit"]}</h2>
            <TripForm
              base={base}
              rooms={data.rooms}
              sites={data.sites}
              today={trip.planned_date}
              words={words}
              editing
              backHref={`${base}/orders/trips/${trip.id}`}
              initial={{ plannedDate: trip.planned_date, vehicleNo: trip.vehicle_no ?? "", driverName: trip.driver_name ?? "", driverPhone: trip.driver_phone ?? "", siteId: trip.site_id ?? "", quantities: Object.fromEntries(trip.lines.map((l) => [l.line_no, String(l.quantity)])) }}
              actions={{ save: updateTripAction.bind(null, tenantId, trip.id) }}
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
