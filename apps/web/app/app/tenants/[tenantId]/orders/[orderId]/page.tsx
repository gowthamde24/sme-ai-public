import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { SECOND_FACTOR_EVENTS, eventsOffered, fetchMembers, fetchOrder, type Member, type OrderDetail } from "@/lib/api/orders";
import { requireUser } from "@/lib/auth/session";

import { EventForm } from "../event-form";
import { recordEventAction } from "../order-actions";
import { OrderView } from "../order-view";

export const metadata = { title: "Order · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ORDER_ROLES = ["owner", "admin", "sales"];

/** Today's date in India (the default day of a money event). */
function todayInIndia(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * /app/tenants/[tenantId]/orders/[orderId]: one order, its ledger, its history and one form per event the rules offer. Server-side only; requireUser() runs FIRST and every call goes
 * to OUR API with the user's own token. A Viewer reads no order (the API refuses). Unknown, malformed and other workspaces' ids produce the SAME not-found page.
 */
export default async function OrderPage({ params }: PageProps<"/app/tenants/[tenantId]/orders/[orderId]">) {
  const user = await requireUser();
  const { tenantId, orderId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(orderId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDown />;
  }
  if (!ORDER_ROLES.includes(tenant.role))
    return (
      <main className="shell wide">
        <p>
          <Link href={`/app/tenants/${tenantId}`}>← {tenant.name}</Link>
        </p>
        <p className="hint">Orders are shown to owners, admins and sales users.</p>
      </main>
    );

  let order: OrderDetail;
  let members: Member[] = [];
  try {
    order = await fetchOrder(user.accessToken, tenantId, orderId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDown />;
  }
  try {
    members = await fetchMembers(user.accessToken, tenantId); // names are a nicety: the order never depends on them
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }

  const now = new Date();
  const offered = eventsOffered({ role: tenant.role, allowed: order.allowed_next_events, order });
  const secondFactorMissing = user.aal !== "aal2";
  const forms =
    offered.length === 0 ? (
      <p className="hint">{order.allowed_next_events.length === 0 ? "Nothing more can be recorded: this order is closed." : "Nothing is left for your role to record. An owner or admin records the rest."}</p>
    ) : (
      <div>
        <p className="hint">These are the entries the rules allow now. They are guidance: the database decides again when you save.</p>
        {offered.map((type) => (
          <EventForm
            key={type}
            type={type}
            action={recordEventAction.bind(null, tenantId, orderId, type)}
            secondFactorMissing={secondFactorMissing && SECOND_FACTOR_EVENTS.includes(type)}
            ids={{ eventId: crypto.randomUUID(), ledgerId: crypto.randomUUID(), renderedAt: now.toISOString(), today: todayInIndia(now) }}
          />
        ))}
      </div>
    );
  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}/orders`}>← Orders</Link>
      </p>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <OrderView tenantId={tenantId} order={order} members={members} forms={forms} />
    </main>
  );
}

function ApiDown() {
  return (
    <main className="shell wide">
      <p role="alert" className="error">
        Could not load this from the API. Try again shortly.
      </p>
      <p>
        <Link href="/app">Back to your workspaces</Link>
      </p>
    </main>
  );
}
