import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchSuppressionStatus, suppressionReadiness, type SuppressionStatus } from "@/lib/api/suppression";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../local-time";
import { backfillKeysAction } from "./actions";
import { BackfillForm } from "./suppression-form";
import { alertBox, mutedText, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { Rich } from "@/components/v2/app/rich";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Suppression keys · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/suppression: which contacts still have no suppression key, and the backfill (ADR 0020). Owner only. Server-side; requireUser() runs FIRST and every call goes to OUR API with
 * the user's own token. Anyone who is not the owner sees a plain notice and nothing is asked of the API for them. The page shows only what the API returns: counts, never a key, an address or a number.
 *
 * It must not read as "all clear" while a contact has no key: the headline comes from one function of the status the API just returned, and anything unknown is "not ready".
 */
export default async function SuppressionPage({ params }: PageProps<"/app/tenants/[tenantId]/suppression">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["supp."]);
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
  if (tenant.role !== "owner")
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("supp.suppression_keys")}</h1>
        <p>{t("supp.only_the_owner_records_suppression_keys")}</p>
      </main>
    );

  let status: SuppressionStatus | null = null;
  try {
    status = await fetchSuppressionStatus(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the headline says NOT ready and shows no number, never a placeholder
  }
  const readiness = suppressionReadiness(status);
  const checkedAt = new Date().toISOString();

  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("supp.suppression_keys")}</h1>
      <p className={mutedText}>
        {t("supp.a_suppression_key_lets_the_system")}
      </p>

      <section aria-labelledby="status-heading">
        <h2 id="status-heading" className={pageH2}>{t("supp.status")}</h2>
        {readiness === "unavailable" && (
          <p role="alert" className={alertBox}>
            <strong>{t("supp.not_ready")}</strong> {t("supp.status_unreadable")}
          </p>
        )}
        {readiness === "no_key" && (
          <p role="alert" className={alertBox}>
            <strong>{t("supp.not_ready")}</strong> {t("supp.key_missing")}
          </p>
        )}
        {readiness === "unkeyed" && (
          <p role="alert" className={alertBox}>
            <strong>{t("supp.not_ready")}</strong>{" "}
            {status?.unkeyed_contacts === null
              ? t("supp.the_number_of_contacts_without_a")
              : status?.unkeyed_contacts === 1
                ? t("supp.unkeyed_one")
                : t("supp.unkeyed_many", { n: status?.unkeyed_contacts ?? 0 })}{" "}
            {t("supp.cannot_receive")}
          </p>
        )}
        {readiness === "clear" && (
          <p role="status">
            {t("supp.no_contact_is_waiting_for_a")}
          </p>
        )}
        {status !== null && (
          <p className={mutedText}>
            <Rich t={t} k="supp.checked_line" with={{ time: <LocalTime iso={checkedAt} /> }} />{status.key_version !== null && " " + t("supp.key_version_line", { n: status.key_version })}
          </p>
        )}
      </section>

      {(readiness === "unkeyed" || readiness === "clear") && (
        <section aria-labelledby="backfill-heading">
          <h2 id="backfill-heading" className={pageH2}>{t("supp.record_keys")}</h2>
          <BackfillForm words={words} action={backfillKeysAction.bind(null, tenantId)} secondFactorMissing={user.aal !== "aal2"} />
        </section>
      )}
    </main>
  );
}
