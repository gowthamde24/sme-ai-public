import type { Me } from "@contracts";
import Link from "next/link";
import { redirect } from "next/navigation";

import { fetchAccountSetup, type AccountSetup } from "@/lib/api/account";
import { ApiAuthError, fetchMe } from "@/lib/api/client";
import { AddButton } from "@/components/v2/app/AddButton";
import { alertBox, bodyText, btnQuiet, dataTable, dataTd, dataThCol, dataTr, inlineLink, pageH1, pageMain, rowBetween, sectionBlock, warnBox } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";
import { Rich } from "@/components/v2/app/rich";
import { makeT } from "@/components/v2/app/words";
import { getLang } from "@/i18n/get-lang";
import { wordsFor } from "@/i18n/app-words";

import { signOut } from "./actions";
import { CreateTenantForm } from "./create-tenant-form";

export const metadata = { title: "Workspaces · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

export default async function AppPage() {
  const user = await requireUser();
  const lang = await getLang();
  const words = wordsFor(lang, ["acct."]);
  const t = makeT(words);

  let me: Me | null = null;
  try {
    me = await fetchMe(user.accessToken);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    // API down or misbehaving: say so. We show real backend state or nothing.
  }
  // The API and Supabase Auth must agree on who this is.
  if (me && me.user_id !== user.id) redirect("/login");
  // One subscriber is one business: with exactly one workspace there is no list to choose from, so the person lands on its Today (Job AC, C5).
  if (me && me.memberships.length === 1) redirect(`/app/tenants/${me.memberships[0].tenant.id}`);
  // A confirmed account with no business yet (just signed up) goes to the set-up screen; the account setup state says so. Anyone else with no workspace (an invited person) sees the empty list below.
  if (me && me.memberships.length === 0) {
    let setup: AccountSetup | null = null;
    try {
      setup = await fetchAccountSetup(user.accessToken);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      // the state could not be read: the empty list below says so
    }
    if (setup?.state === "needed") redirect("/setup");
  }

  return (
    <main className={pageMain} lang={lang}>
      <header className={rowBetween}>
        <h1 className={pageH1}>{t("acct.workspaces")}</h1>
        <form action={signOut}>
          <button type="submit" className={btnQuiet}>
            {t("acct.sign_out")}
          </button>
        </form>
      </header>
      <p className={bodyText}>
        <Rich t={t} k="acct.signed_in_as" vars={{ email: user.email ?? t("acct.your_account") }} /> <Link href="/app/security" className={inlineLink}>{t("acct.security")}</Link>
      </p>
      {me?.memberships.some((m) => m.role === "owner" || m.role === "admin") &&
        !user.hasSecondFactor && (
          <p role="note" className={warnBox}>
            <strong>{t("acct.set_up_your_authenticator_app")}</strong> {t("acct.owner_notice")} <Link href="/app/security" className={inlineLink}>{t("acct.set_it_up")}</Link>
          </p>
        )}

      {me === null ? (
        <p role="alert" className={alertBox}>
          {t("acct.could_not_load_your_workspaces_from")}
        </p>
      ) : me.memberships.length === 0 ? (
        <p className={bodyText}>{t("acct.you_do_not_belong_to_a")}</p>
      ) : (
        <table className={`mt-4 ${dataTable}`}>
          <thead>
            <tr>
              <th className={dataThCol}>{t("acct.workspace")}</th>
              <th className={dataThCol}>{t("acct.url_name")}</th>
              <th className={dataThCol}>{t("acct.your_role")}</th>
            </tr>
          </thead>
          <tbody>
            {me.memberships.map(({ tenant, role }) => (
              <tr key={tenant.id} className={dataTr}>
                <td data-label={t("acct.workspace")} className={dataTd}>
                  <Link href={`/app/tenants/${tenant.id}`} className={inlineLink}>{tenant.name}</Link>
                </td>
                <td data-label={t("acct.url_name")} className={dataTd}>{tenant.slug}</td>
                <td data-label={t("acct.your_role")} className={dataTd}>{role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div id="create-workspace" className={sectionBlock}>
        <AddButton key={me?.memberships.length ?? 0} label={t("acct.add_a_workspace")}>
          <CreateTenantForm words={words} />
        </AddButton>
      </div>
    </main>
  );
}
