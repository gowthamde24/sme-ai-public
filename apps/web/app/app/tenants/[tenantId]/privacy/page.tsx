import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchPage, isCanonicalUuid } from "@/lib/api/crm";
import {
  confirmationPhrase,
  fetchErasureRequests,
  SCOPE_LABELS,
  STATUS_LABELS,
  type PageErasureRequestOut,
} from "@/lib/api/erasure";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../local-time";
import {
  cancelErasureAction,
  executeErasureAction,
  previewErasureAction,
  requestErasureAction,
} from "./actions";
import {
  CancelForm,
  ExecuteForm,
  NewRequestForm,
  PreviewForm,
  ResultView,
} from "./privacy-forms";
import { alertBox, dataTable, dataTd, dataThCol, dataTr, mutedText, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2 } from "@/components/v2/app/parts";

export const metadata = { title: "Privacy · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["owner", "admin"];

/**
 * /app/tenants/[tenantId]/privacy: erasing personal data on request (ADR 0014). Owner and Admin only: an Admin may ask,
 * only the Owner can run. Real backend state only; requireUser() runs FIRST and every call goes to OUR API with the
 * user's own token. The buttons are shown by role as a convenience; the API and the database enforce the roles regardless.
 */
export default async function PrivacyPage({
  params,
}: PageProps<"/app/tenants/[tenantId]/privacy">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  if (!ADMIN_ROLES.includes(tenant.role)) {
    return (
      <main className={pageMain}>
        <h1 className={pageH1}>Privacy</h1>
        <p>Only an owner or admin can ask for personal data to be erased.</p>
      </main>
    );
  }
  const isOwner = tenant.role === "owner";

  let requests: PageErasureRequestOut | null = null;
  let contacts: { id: string; name: string }[] = [];
  let companies: { id: string; name: string }[] = [];
  const phrases = new Map<string, string>();
  try {
    requests = await fetchErasureRequests(user.accessToken, tenantId);
    if (isOwner)
      for (const request of requests.items)
        if (request.status === "pending")
          phrases.set(request.id, await confirmationPhrase(user.accessToken, tenantId, request));
    const contactPage = await fetchPage(user.accessToken, tenantId, "contacts");
    if (contactPage.entity === "contacts")
      contacts = contactPage.items.map((row) => ({
        id: row.id,
        name: row.full_name,
      }));
    const companyPage = await fetchPage(
      user.accessToken,
      tenantId,
      "companies",
    );
    if (companyPage.entity === "companies")
      companies = companyPage.items.map((row) => ({
        id: row.id,
        name: row.name,
      }));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the sections below show an error, never placeholder data
  }

  return (
    <main className={pageMain}>
      <h1 className={pageH1}>Privacy</h1>
      <p className={mutedText}>
        Erasing a person replaces their name, e-mail, phone and the personal
        text we hold about them with a marker. Labels, scores, counts and the
        consent history stay, so your data stays useful. It cannot be undone.
        Erasing one contact or one company happens when the owner confirms.
        Erasing the whole workspace waits 24 hours and can be cancelled until
        then.
      </p>
      <p className={mutedText}>
        What this cannot do: find a name written inside longer text (those rows
        are listed for you to read), files you already exported or downloaded,
        or backups (they age out). Erasing the whole workspace keeps company
        names and places: a sole proprietor&apos;s business is erased with
        &quot;One company&quot;.
      </p>

      <section aria-labelledby="new-heading">
        <h2 id="new-heading" className={pageH2}>Ask for an erasure</h2>
        {requests === null ? (
          <p role="alert" className={alertBox}>
            Could not load this from the API. Try again shortly.
          </p>
        ) : (
          <NewRequestForm
            action={requestErasureAction.bind(null, tenantId)}
            requestId={crypto.randomUUID()}
            contacts={contacts}
            companies={companies}
          />
        )}
      </section>

      <section aria-labelledby="requests-heading">
        <h2 id="requests-heading" className={pageH2}>Requests</h2>
        {requests === null ? (
          <p role="alert" className={alertBox}>
            Could not load the requests from the API. Try again shortly.
          </p>
        ) : requests.items.length === 0 ? (
          <p>No requests yet.</p>
        ) : (
          <table className={`mt-4 ${dataTable}`}>
            <thead>
              <tr>
                <th className={dataThCol}>Requested</th>
                <th className={dataThCol}>What</th>
                <th className={dataThCol}>Status</th>
                <th className={dataThCol}>Can run from</th>
                <th className={dataThCol}>Requested by</th>
                <th className={dataThCol} />
              </tr>
            </thead>
            <tbody>
              {requests.items.map((request) => (
                <tr key={request.id} className={dataTr}>
                  <td data-label="Requested" className={dataTd}>
                    <LocalTime iso={request.created_at} />
                  </td>
                  <td data-label="What" className={dataTd}>{SCOPE_LABELS[request.scope]}</td>
                  <td data-label="Status" className={dataTd}>{STATUS_LABELS[request.status]}</td>
                  <td data-label="Can run from" className={dataTd}>
                    <LocalTime iso={request.execute_after} />
                  </td>
                  <td data-label="Requested by" className={dataTd}>
                    {request.requested_by === user.id ? "you" : "a teammate"}
                  </td>
                  <td data-label="" className={dataTd}>
                    {request.status === "pending" && (
                      <>
                        {isOwner && (
                          <>
                            <PreviewForm
                              action={previewErasureAction.bind(
                                null,
                                tenantId,
                                request.id,
                              )}
                            />
                            <ExecuteForm
                              action={executeErasureAction.bind(
                                null,
                                tenantId,
                                request.id,
                              )}
                              phrase={phrases.get(request.id) ?? "ERASE"}
                            />
                          </>
                        )}
                        <CancelForm
                          action={cancelErasureAction.bind(
                            null,
                            tenantId,
                            request.id,
                          )}
                        />
                        {!isOwner && (
                          <p className={mutedText}>Only the owner can run this.</p>
                        )}
                      </>
                    )}
                    {request.status === "executed" && request.result && (
                      <ResultView result={request.result} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

