import Link from "next/link";

import { backLink, bodyText, mutedText, okBox, pageH1, pageH2, pageMain, surface } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { EnrolForm, RemoveForm } from "./security-forms";

export const metadata = { title: "Security · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/**
 * /app/security: the second factor. Owners and Admins need an authenticator to erase data, export, change members or roles, and
 * change workspace settings (ADR 0016); everyone may have one. requireUser() runs first.
 */
export default async function SecurityPage({ searchParams }: PageProps<"/app/security">) {
  const user = await requireUser();
  const params = await searchParams;
  const done = params.done !== undefined;
  const removed = params.removed !== undefined;

  return (
    <main className={pageMain}>
      <p>
        <Link href="/app" className={backLink}>
          ← Workspaces
        </Link>
      </p>
      <h1 className={pageH1}>Security</h1>
      <p className={bodyText}>
        Signed in as {user.email ?? "your account"}. Session: <strong>{user.aal === "aal2" ? "verified with your authenticator" : "password only"}</strong>.
      </p>
      {done && <p role="status" className={okBox}>Done. Your authenticator is on.</p>}
      {removed && <p role="status" className={okBox}>Your authenticator was removed.</p>}

      <section aria-labelledby="mfa-heading" className={`mt-6 ${surface}`}>
        <h2 id="mfa-heading" className={pageH2}>
          Authenticator app
        </h2>
        {user.hasSecondFactor ? (
          <>
            <p className={bodyText}>
              <strong>On.</strong> You type a code from your app after your password.
            </p>
            <RemoveForm />
            <p className={mutedText}>
              If you remove it you can no longer erase data, export, change members or roles, or change workspace settings until you set a new one.
            </p>
          </>
        ) : (
          <>
            <p className={bodyText}>
              <strong>Not set up.</strong> Owners and Admins need an authenticator app to erase data, export, change members or roles, and change
              workspace settings. It takes a minute.
            </p>
            <EnrolForm />
          </>
        )}
      </section>

      <section aria-labelledby="lost-heading" className={`mt-6 ${surface}`}>
        <h2 id="lost-heading" className={pageH2}>
          If you lose your phone
        </h2>
        <p className={bodyText}>
          There are no backup codes. Ask the operator of this system. They confirm who you are some other way (a call, a meeting), remove the old
          authenticator and sign you out everywhere. Then you sign in with your password and set up a new one.
        </p>
      </section>
    </main>
  );
}
