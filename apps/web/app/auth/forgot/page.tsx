import Link from "next/link";

import { authH1, authLead, authLink, authMain, authParagraph } from "@/components/v2/auth/ui";

import { ForgotForm } from "./forgot-form";
import { BRAND_NAME } from "@/design/brand";
import { authLang, formWords } from "@/i18n/auth";

export const metadata = { title: `Reset your password · ${BRAND_NAME}` };

export default async function ForgotPage() {
  const w = formWords(await authLang());
  return (
    <main id="main" className={authMain}>
      <h1 className={authH1}>{w["form.forgot.title"]}</h1>
      <p className={authLead}>{w["form.forgot.lead"]}</p>
      <ForgotForm words={{ email: w["form.email"], send: w["form.forgot.send"], sending: w["form.forgot.sending"] }} />
      <p className={authParagraph}>
        <Link href="/login" className={authLink}>{w["form.forgot.back"]}</Link>
      </p>
    </main>
  );
}
