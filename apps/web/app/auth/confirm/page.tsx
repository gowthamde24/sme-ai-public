import Link from "next/link";

import { parseConfirmType, parseTokenHash } from "@/lib/auth/otp";
import { safeRedirectPath } from "@/lib/auth/redirect";

import { ConfirmForm } from "./confirm-form";

export const metadata = { title: "Confirm · SME AI Revenue Engine" };

const HEADINGS = {
  invite: "You are invited",
  recovery: "Reset your password",
  email: "Confirm your email",
} as const;

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The page an e-mailed link lands on (invite, password reset, e-mail confirmation). It shows a button; pressing it verifies the one-time
 * token. Verifying on page load would let a mail scanner that fetches links use the token up before the person ever sees it.
 */
export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const params = await searchParams;
  const type = parseConfirmType(pick(params.type));
  const tokenHash = parseTokenHash(pick(params.token_hash));
  // Validated here for display and again in the action; a same-site relative path or the default, never anything else.
  const next = safeRedirectPath(pick(params.next));

  if (!type || !tokenHash) {
    return (
      <main className="shell">
        <h1>This link does not work</h1>
        <p role="alert" className="error">
          This link has expired or was already used. Request a new one.
        </p>
        <p>
          <Link href="/auth/forgot">Reset your password</Link> · <Link href="/login">Sign in</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="shell">
      <h1>{HEADINGS[type]}</h1>
      <p>
        {type === "email"
          ? "Press Continue to confirm your email address."
          : "Press Continue, then choose a password for your account."}
      </p>
      <ConfirmForm tokenHash={tokenHash} type={type} next={next} />
    </main>
  );
}
