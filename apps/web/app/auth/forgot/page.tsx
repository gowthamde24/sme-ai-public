import Link from "next/link";

import { authH1, authLead, authLink, authMain, authParagraph } from "@/components/v2/auth/ui";

import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset your password · SME AI Revenue Engine" };

export default function ForgotPage() {
  return (
    <main id="main" className={authMain}>
      <h1 className={authH1}>Reset your password</h1>
      <p className={authLead}>Enter the email address of your account. If it has one, we send a link that lets you choose a new password.</p>
      <ForgotForm />
      <p className={authParagraph}>
        <Link href="/login" className={authLink}>Back to sign in</Link>
      </p>
    </main>
  );
}
