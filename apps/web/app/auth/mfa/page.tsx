import { redirect } from "next/navigation";

import { authH1, authHint, authLead, authMain } from "@/components/v2/auth/ui";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { requireUserBeforeSecondFactor } from "@/lib/auth/session";

import { MfaForm } from "./mfa-form";
import { BRAND_NAME } from "@/design/brand";
import { authLang, formWords } from "@/i18n/auth";

export const metadata = { title: `Verify · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: PageProps<"/auth/mfa">) {
  const user = await requireUserBeforeSecondFactor();
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeRedirectPath(raw);

  if (user.aal === "aal2") redirect(next); // nothing to do
  if (!user.hasSecondFactor) redirect("/app/security"); // nothing to answer: set one up

  const w = formWords(await authLang());
  return (
    <main id="main" className={authMain}>
      <h1 className={authH1}>{w["form.mfa.title"]}</h1>
      <p className={authLead}>{w["form.mfa.lead"]}</p>
      <MfaForm next={next} words={{ label: w["form.mfa.label"], verify: w["form.mfa.verify"], checking: w["form.mfa.checking"], signOut: w["form.mfa.signout"] }} />
      <p className={authHint}>
        Lost your phone? Write to us. We will check who you are some other way, remove the old
        authenticator, and let you set up a new one. Until then you can sign in, but not erase data, export, or change members and settings.
      </p>
    </main>
  );
}
