import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { OUTCOME_LABELS, STATE_LABELS, fetchOrders, formatRupees, type OrderPage } from "@/lib/api/orders";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../local-time";

export const metadata = { title: "Orders · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ORDER_ROLES = ["owner", "admin", "sales"];

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** /app/tenants/[tenantId]/orders: the workspace's orders, newest first. A Viewer sees no order (and no amount); the API refuses them too. */
export default async function OrdersPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/orders">) {
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
    return <ApiDown />;
  }
  const back = (
    <p>
      <Link href={`/app/tenants/${tenantId}`}>← {tenant.name}</Link>
    </p>
  );
  if (!ORDER_ROLES.includes(tenant.role))
    return (
      <main className="shell wide">
        {back}
        <h1>Orders</h1>
        <p className="hint">Orders are shown to owners, admins and sales users.</p>
      </main>
    );

  let page: OrderPage;
  try {
    page = await fetchOrders(user.accessToken, tenantId, { cursor: pick(query.cursor) ?? null });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDown />;
  }
  return (
    <main className="shell wide">
      {back}
      <h1>Orders</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <p role="note" className="notice">
        Nothing is sent by this system: every entry in an order is a record of something that happened outside it.
      </p>
      {page.items.length === 0 ? (
        <p>No orders yet. An owner or admin starts one from an approved quote.</p>
      ) : (
        <ul aria-label="Orders, newest first">
          {page.items.map((o) => (
            <li key={o.id} className="card">
              <Link href={`/app/tenants/${tenantId}/orders/${o.id}`} className="tap">
                <strong>Order {o.order_no}</strong>
              </Link>{" "}
              · {OUTCOME_LABELS[o.outcome]} · {STATE_LABELS[o.state]}
              <br />
              <span className="hint">
                Total {formatRupees(o.order_total_paise)} · received {formatRupees(o.paid_paise)} · started <LocalTime iso={o.created_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {page.next_cursor ? (
        <p>
          <Link href={`/app/tenants/${tenantId}/orders?cursor=${encodeURIComponent(page.next_cursor)}`} className="tap">
            Older orders →
          </Link>
        </p>
      ) : null}
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
