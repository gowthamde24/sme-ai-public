import { lineRooms, type LineRoom } from "@/components/v2/app/deliveries/trip-logic";
import { ApiAuthError } from "@/lib/api/client";
import { fetchLead } from "@/lib/api/crm";
import { listOrderTrips } from "@/lib/api/deliveries";
import { getMaterialPolicy, getMaterialQuote } from "@/lib/api/materials";
import { fetchOrder, type OrderDetail } from "@/lib/api/orders";
import { listSites } from "@/lib/api/sites";

export type OrderTripsData = { order: OrderDetail; rooms: LineRoom[]; sites: { id: string; label: string }[]; capacity: number | null; trips: Awaited<ReturnType<typeof listOrderTrips>>["items"] };

/**
 * What the trip form needs about one material order (job CO): the order, how much of each quote line is still to be sent (the trips that are not cancelled count; the trip being changed does not), the customer's sites
 * and what one truck carries (to suggest the first load). A part that cannot be read leaves the form with less help, never with a wrong number: the API checks the quantities again. A rejected session is thrown again.
 */
export async function loadOrderTrips(accessToken: string, tenantId: string, orderId: string, pcsWord: string, exceptTripId?: string): Promise<OrderTripsData | null> {
  const order = await fetchOrder(accessToken, tenantId, orderId);
  if (!order.material_quote_id) return null;
  const [quote, trips, policy, lead] = await Promise.all([
    getMaterialQuote(accessToken, tenantId, order.material_quote_id),
    listOrderTrips(accessToken, tenantId, orderId),
    getMaterialPolicy(accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)),
    fetchLead(accessToken, tenantId, order.lead_id).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)),
  ]);
  const sites = lead?.company_id ? await listSites(accessToken, tenantId, { companyId: lead.company_id, limit: 50 }).then((p) => p.items.filter((s) => s.active).map((s) => ({ id: s.id, label: [s.name, s.city].filter(Boolean).join(", ") }))).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : [])) : [];
  const t = policy?.current?.policy.transport;
  return {
    order,
    rooms: lineRooms(quote, trips.items.filter((x) => x.id !== exceptTripId), pcsWord),
    sites,
    capacity: t && t.capacity_basis === "pieces" && t.truck_capacity ? t.truck_capacity : null,
    trips: trips.items,
  };
}
