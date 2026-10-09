import type { Me } from "@contracts";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchMe } from "@/lib/api/client";
import { AddButton } from "@/components/v2/app/AddButton";
import { alertBox, bodyText, btnQuiet, dataTable, dataTd, dataThCol, dataTr, inlineLink, pageH1, pageMain, rowBetween, sectionBlock, warnBox } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { signOut } from "./actions";
import { CreateTenantForm } from "./create-tenant-form";

export const metadata = { title: "Workspaces · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

export default async function AppPage() {
  const user = await requireUser();

  let me: Me | null = null;
  try {
    me = await fetchMe(user.accessToken);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    // API down or misbehaving: say so. We show real backend state or nothing.
  }
  // The API and Supabase Auth must agree on who this is.
  if (me && me.user_id !== user.id) redirect("/login");

  return (
    <main className={pageMain}>
      <header className={rowBetween}>
        <h1 className={pageH1}>Workspaces</h1>
        <form action={signOut}>
          <button type="submit" className={btnQuiet}>
            Sign out
          </button>
        </form>
      </header>
      <p className={bodyText}>
        Signed in as {user.email ?? "your account"}. <Link href="/app/security" className={inlineLink}>Security</Link>
      </p>
      {me?.memberships.some((m) => m.role === "owner" || m.role === "admin") &&
        !user.hasSecondFactor && (
          <p role="note" className={warnBox}>
            <strong>Set up your authenticator app.</strong> As an owner or admin you need it to erase data, export, change members or roles, and
            change workspace settings. <Link href="/app/security" className={inlineLink}>Set it up</Link>
          </p>
        )}

      {me === null ? (
        <p role="alert" className={alertBox}>
          Could not load your workspaces from the API. Try again shortly.
        </p>
      ) : me.memberships.length === 0 ? (
        <p className={bodyText}>You do not belong to a workspace yet. Create one to get started.</p>
      ) : (
        <table className={`mt-4 ${dataTable}`}>
          <thead>
            <tr>
              <th className={dataThCol}>Workspace</th>
              <th className={dataThCol}>URL name</th>
              <th className={dataThCol}>Your role</th>
            </tr>
          </thead>
          <tbody>
            {me.memberships.map(({ tenant, role }) => (
              <tr key={tenant.id} className={dataTr}>
                <td data-label="Workspace" className={dataTd}>
                  <Link href={`/app/tenants/${tenant.id}`} className={inlineLink}>{tenant.name}</Link>
                </td>
                <td data-label="URL name" className={dataTd}>{tenant.slug}</td>
                <td data-label="Your role" className={dataTd}>{role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div id="create-workspace" className={sectionBlock}>
        <AddButton key={me?.memberships.length ?? 0} label="Add a workspace">
          <CreateTenantForm />
        </AddButton>
      </div>
    </main>
  );
}
