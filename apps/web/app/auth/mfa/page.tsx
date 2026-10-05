import { redirect } from "next/navigation";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { requireUserBeforeSecondFactor } from "@/lib/auth/session";

import { MfaForm } from "./mfa-form";

export const metadata = { title: "Verify · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: PageProps<"/auth/mfa">) {
  const user = await requireUserBeforeSecondFactor();
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeRedirectPath(raw);

  if (user.aal === "aal2") redirect(next); // nothing to do
  if (!user.hasSecondFactor) redirect("/app/security"); // nothing to answer: set one up

  return (
    <main className="shell">
      <h1>Enter your code</h1>
      <p>Open your authenticator app and type the six digits it shows for this account.</p>
      <MfaForm next={next} />
      <p className="hint">
        Lost your phone? Ask the operator of this system. They will check who you are some other way, remove the old
        authenticator, and let you set up a new one. Until then you can sign in, but not erase data, export, or change members and settings.
      </p>
    </main>
  );
}
