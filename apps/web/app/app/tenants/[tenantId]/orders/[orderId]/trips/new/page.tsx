import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TripForm } from "@/components/v2/app/deliveries/TripForm";
import { dayInIndia } from "@/components/v2/app/deliveries/trip-logic";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { clock } from "@/lib/clock";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { planTripAction } from "../../../trips/trip-actions";
import { loadOrderTrips } from "../../../trips/trip-data";
import { tripWords } from "../../../trips/trip-words";

export const metadata = { title: "Plan a trip · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/orders/[orderId]/trips/new: plan a trip for a building-materials order (job CO). Owner, Admin, Sales. The first truck is filled up to what a truck carries. The page makes the trip's id, so pressing Save twice is a retry. */
export default async function PlanTripPage({ params }: PageProps<"/app/tenants/[tenantId]/orders/[orderId]/trips/new">) {
  const user = await requireUser();
  const { tenantId, orderId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(orderId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role === "viewer" || !hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "deliveries")) redirect(`${base}/orders/${orderId}`);
  const lang = await getLang();
  const words = tripWords(lang);
  let data;
  try {
    data = await loadOrderTrips(user.accessToken, tenantId, orderId, words["mat.unit.piece"]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!data) notFound();
  const today = dayInIndia(clock());
  const first = data.rooms.map((r) => [r.lineNo, r.remaining > 0 ? String(data.capacity !== null ? Math.min(r.remaining, data.capacity) : r.remaining) : ""] as const);
  return (
    <main className={pageMain} lang={lang}>
      <p><Link href={`${base}/orders/${orderId}`} className={backLink}>← {(words["trip.order"] ?? "").replace("{n}", String(data.order.order_no))}</Link></p>
      <h1 className="mb-4 mt-2 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{words["trip.plan.title"]}</h1>
      <TripForm
        base={base}
        rooms={data.rooms}
        sites={data.sites}
        today={today}
        words={words}
        editing={false}
        backHref={`${base}/orders/${orderId}`}
        initial={{ plannedDate: today, vehicleNo: "", driverName: "", driverPhone: "", siteId: data.order.site_id ?? "", quantities: Object.fromEntries(first) }}
        actions={{ save: planTripAction.bind(null, tenantId, orderId, randomUUID()) }}
      />
    </main>
  );
}
