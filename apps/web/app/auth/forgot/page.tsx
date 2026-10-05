import Link from "next/link";

import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset your password · SME AI Revenue Engine" };

export default function ForgotPage() {
  return (
    <main className="shell">
      <h1>Reset your password</h1>
      <p>Enter the email address of your account. If it has one, we send a link that lets you choose a new password.</p>
      <ForgotForm />
      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
