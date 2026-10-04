import type { Me } from "@contracts";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchMe } from "@/lib/api/client";
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
    <main className="shell">
      <header className="row between">
        <h1>Workspaces</h1>
        <form action={signOut}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </header>
      <p>Signed in as {user.email ?? "your account"}.</p>

      {me === null ? (
        <p role="alert" className="error">
          Could not load your workspaces from the API. Try again shortly.
        </p>
      ) : me.memberships.length === 0 ? (
        <p>You do not belong to a workspace yet. Create one to get started.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Workspace</th>
              <th>URL name</th>
              <th>Your role</th>
            </tr>
          </thead>
          <tbody>
            {me.memberships.map(({ tenant, role }) => (
              <tr key={tenant.id}>
                <td>
                  <Link href={`/app/tenants/${tenant.id}`}>{tenant.name}</Link>
                </td>
                <td>{tenant.slug}</td>
                <td>{role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Create a workspace</h2>
      <CreateTenantForm />
    </main>
  );
}
