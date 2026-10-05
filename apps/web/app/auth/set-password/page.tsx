import { requireUser } from "@/lib/auth/session";

import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Choose a password · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** Reached from /auth/confirm after an invite or a reset link. Needs the session that link created; without one it goes to /login. */
export default async function SetPasswordPage({ searchParams }: PageProps<"/auth/set-password">) {
  await requireUser();
  const params = await searchParams;
  const type = Array.isArray(params.type) ? params.type[0] : params.type;
  return (
    <main className="shell">
      <h1>{type === "invite" ? "Welcome: choose a password" : "Choose a new password"}</h1>
      <SetPasswordForm />
    </main>
  );
}
