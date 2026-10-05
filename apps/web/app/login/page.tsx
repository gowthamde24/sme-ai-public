import { safeRedirectPath } from "@/lib/auth/redirect";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · SME AI Revenue Engine" };

const NOTICES: Record<string, string> = {
  link: "That link has expired or was already used. Request a new one from \"Forgot your password?\".",
  reset: "Your password was changed. Sign in with the new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  // Validated here for display and again inside the server action; the form field is untrusted.
  const next = safeRedirectPath(raw);
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;

  return (
    <main className="shell">
      <h1>Sign in</h1>
      <LoginForm next={next} notice={NOTICES[notice ?? ""]} />
    </main>
  );
}
