import { ArrowRight, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { HELD_TEXT, OUTCOME_LABELS, STATE_LABELS, fetchOrders, formatRupees, moneyHeld, type OrderPage } from "@/lib/api/orders";
import { ApiDownV2, PageTop, SegmentLinks } from "@/components/v2/app/parts";
import { btnMain, cellRight, figureRow, link, metaLine, mutedText, pageH1, pageMain, pillAmber, pillBrand, pillGreen, spaceTop, surface } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../local-time";

export const metadata = { title: "Orders · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ORDER_ROLES = ["owner", "admin", "sales"];
const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "In progress" },
  { key: "closed", label: "Closed" },
  { key: "held", label: "Money held" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

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
    return <ApiDownV2 />;
  }
  if (!ORDER_ROLES.includes(tenant.role))
    return (
      <main className={pageMain}>
        <h1 className={pageH1}>Orders</h1>
        <p className={mutedText}>Orders are shown to owners, admins and sales users.</p>
      </main>
    );

  let page: OrderPage;
  try {
    page = await fetchOrders(user.accessToken, tenantId, { cursor: pick(query.cursor) ?? null });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return <ApiDownV2 />;
  }
  const filter = FILTERS.some((f) => f.key === pick(query.filter)) ? (pick(query.filter) as FilterKey) : "all";
  const shown = page.items.filter((o) => filter === "all" || (filter === "open" && o.outcome === "open") || (filter === "closed" && o.outcome !== "open") || (filter === "held" && moneyHeld(o) > 0));
  const here = `/app/tenants/${tenantId}/orders`;
  return (
    <main className={pageMain}>
      <PageTop
        title="Orders"
        sub={<span role="note">Nothing is sent by this system: every entry in an order is a record of something that happened outside it.</span>}
        action={
          <Link href={`/app/tenants/${tenantId}/quotes`} className={`${btnMain} gap-2`}>
            <Plus className="size-5" aria-hidden="true" />
            Start order
          </Link>
        }
      />
      <SegmentLinks label="Show orders" items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: f.key === "all" ? here : `${here}?filter=${f.key}`, current: f.key === filter }))} />
      {page.items.length === 0 ? (
        <p className={spaceTop}>No orders yet. An owner or admin starts one from an approved quote.</p>
      ) : shown.length === 0 ? (
        <p className={spaceTop}>No order on this page matches. Older orders may.</p>
      ) : (
        <ul aria-label="Orders, newest first" className="mt-4 flex flex-col gap-3">
          {shown.map((o) => (
            <li key={o.id} className={surface}>
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`${here}/${o.id}`} className="font-mono text-lg font-bold hover:underline">
                      Order {o.order_no}
                    </Link>
                    <span className={o.outcome === "open" ? pillBrand : o.outcome === "won" ? pillGreen : pillAmber}>
                      {OUTCOME_LABELS[o.outcome]} · {STATE_LABELS[o.state]}
                    </span>
                  </p>
                  <span className={metaLine}>
                    Started <LocalTime iso={o.created_at} />
                  </span>
                </div>
                <dl className={figureRow}>
                  <div>
                    <dt className="text-sm text-muted">Total</dt>
                    <dd className="font-semibold tabular-nums">{formatRupees(o.order_total_paise)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Received</dt>
                    <dd className="font-semibold tabular-nums">{formatRupees(o.paid_paise)}</dd>
                  </div>
                </dl>
              </div>
              {moneyHeld(o) > 0 ? (
                <p role="note" className="mt-3 flex items-center gap-2 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 font-semibold text-amber-text">
                  <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
                  {HELD_TEXT(moneyHeld(o))}
                </p>
              ) : null}
              <p className={`mt-2 ${cellRight}`}>
                <Link href={`${here}/${o.id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text hover:underline">
                  Details
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
      {page.next_cursor ? (
        <p className={spaceTop}>
          <Link href={`${here}?cursor=${encodeURIComponent(page.next_cursor)}`} className={link}>
            Older orders →
          </Link>
        </p>
      ) : null}
    </main>
  );
}
