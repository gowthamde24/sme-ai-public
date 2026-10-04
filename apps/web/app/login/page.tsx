import { safeRedirectPath } from "@/lib/auth/redirect";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · SME AI Revenue Engine" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  // Validated here for display and again inside the server action; the form field is untrusted.
  const next = safeRedirectPath(raw);

  return (
    <main className="shell">
      <h1>Sign in</h1>
      <LoginForm next={next} />
    </main>
  );
}
