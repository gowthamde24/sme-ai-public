import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { fetchPage, isCanonicalUuid } from "@/lib/api/crm";
import { confirmationPhrase, fetchErasureRequests, type PageErasureRequestOut } from "@/lib/api/erasure";
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
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

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
  const lang = await getLang();
  const words = wordsFor(lang, ["prv."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
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
  if (!ADMIN_ROLES.includes(tenant.role)) {
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("prv.privacy")}</h1>
        <p>{t("prv.only_an_owner_or_admin_can")}</p>
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
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("prv.privacy")}</h1>
      <p className={mutedText}>
        {t("prv.erasing_a_person_replaces_their_name")}
      </p>
      <p className={mutedText}>
        {t("prv.what_this_cannot_do_find_a")}
      </p>

      <section aria-labelledby="new-heading">
        <h2 id="new-heading" className={pageH2}>{t("prv.ask_for_an_erasure")}</h2>
        {requests === null ? (
          <p role="alert" className={alertBox}>
            {t("prv.could_not_load_this_from_the")}
          </p>
        ) : (
          <NewRequestForm words={words}
            action={requestErasureAction.bind(null, tenantId)}
            requestId={crypto.randomUUID()}
            contacts={contacts}
            companies={companies}
          />
        )}
      </section>

      <section aria-labelledby="requests-heading">
        <h2 id="requests-heading" className={pageH2}>{t("prv.requests")}</h2>
        {requests === null ? (
          <p role="alert" className={alertBox}>
            {t("prv.could_not_load_the_requests_from")}
          </p>
        ) : requests.items.length === 0 ? (
          <p>{t("prv.no_requests_yet")}</p>
        ) : (
          <table className={`mt-4 ${dataTable}`}>
            <thead>
              <tr>
                <th className={dataThCol}>{t("prv.requested")}</th>
                <th className={dataThCol}>{t("prv.what")}</th>
                <th className={dataThCol}>{t("prv.status")}</th>
                <th className={dataThCol}>{t("prv.can_run_from")}</th>
                <th className={dataThCol}>{t("prv.requested_by")}</th>
                <th className={dataThCol} />
              </tr>
            </thead>
            <tbody>
              {requests.items.map((request) => (
                <tr key={request.id} className={dataTr}>
                  <td data-label={t("prv.col_requested")} className={dataTd}>
                    <LocalTime iso={request.created_at} />
                  </td>
                  <td data-label={t("prv.col_what")} className={dataTd}>{t(`prv.scope.${request.scope}`)}</td>
                  <td data-label={t("prv.col_status")} className={dataTd}>{t(`prv.status.${request.status}`)}</td>
                  <td data-label={t("prv.col_can_run_from")} className={dataTd}>
                    <LocalTime iso={request.execute_after} />
                  </td>
                  <td data-label={t("prv.col_requested_by")} className={dataTd}>
                    {request.requested_by === user.id ? "you" : t("prv.a_teammate")}
                  </td>
                  <td data-label="" className={dataTd}>
                    {request.status === "pending" && (
                      <>
                        {isOwner && (
                          <>
                            <PreviewForm words={words}
                              action={previewErasureAction.bind(
                                null,
                                tenantId,
                                request.id,
                              )}
                            />
                            <ExecuteForm words={words}
                              action={executeErasureAction.bind(
                                null,
                                tenantId,
                                request.id,
                              )}
                              phrase={phrases.get(request.id) ?? "ERASE"}
                            />
                          </>
                        )}
                        <CancelForm words={words}
                          action={cancelErasureAction.bind(
                            null,
                            tenantId,
                            request.id,
                          )}
                        />
                        {!isOwner && (
                          <p className={mutedText}>{t("prv.only_the_owner_can_run_this")}</p>
                        )}
                      </>
                    )}
                    {request.status === "executed" && request.result && (
                      <ResultView words={words} result={request.result} />
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

