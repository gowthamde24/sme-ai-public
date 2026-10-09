import { notFound, redirect } from "next/navigation";

import { fetchAgentClaims, type ClaimSuggestionOut } from "@/lib/api/agents";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { ReviewScreen } from "../review-screen";
import { LeadsTabs } from "@/components/v2/app/parts";
import { alertBox, link, mutedText, pageH1, pageMain } from "@/components/v2/app/ui";

export const metadata = { title: "Review suggestions · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["owner", "admin"];

/**
 * Review the workspace's agent suggestions (T007 M3). Every member may SEE them; only an owner or admin gets the accept and
 * reject controls (the API and the database refuse everyone else regardless). Nothing an agent wrote counts toward a score
 * until a person accepts it here.
 */
export default async function SuggestionsPage({ params }: PageProps<"/app/tenants/[tenantId]/suggestions">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return (
      <main className={pageMain}>
        <p role="alert" className={alertBox}>
          Could not load this workspace from the API. Try again shortly.
        </p>
      </main>
    );
  }

  let claims: ClaimSuggestionOut[] | null = null;
  try {
    claims = await fetchAgentClaims(user.accessToken, tenantId, "all", 100);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the screen says so, never placeholder data
  }

  const canReview = ADMIN_ROLES.includes(tenant.role);
  // one pair of review ids per claim, once per render: a double tap or a retry re-sends the SAME id and is one review
  const reviewIds = Object.fromEntries(
    (claims ?? []).map((c) => [c.id, { accept: crypto.randomUUID(), reject: crypto.randomUUID() }]),
  );

  return (
    <main className={pageMain}>
      <h1 className={pageH1}>Review suggestions</h1>
      <LeadsTabs tenantId={tenantId} role={tenant.role} current="suggestions" />
      <p className={mutedText}>
        An agent only suggests. Each suggestion shows the quote it rests on and where it came from, as plain text. The quote was
        checked by the agent runtime, not by the database. A suggestion counts toward a score only after an owner or admin
        accepts it; the newest decision on a suggestion wins.
        {!canReview && " Only an owner or admin can accept or reject."}
      </p>
      <ReviewScreen tenantId={tenantId} claims={claims} canReview={canReview} reviewIds={reviewIds} />
    </main>
  );
}
