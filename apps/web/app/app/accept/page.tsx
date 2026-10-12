import { redirect } from "next/navigation";

import { AcceptForm } from "@/components/v2/app/accept/AcceptForm";
import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { pageMain } from "@/components/v2/app/ui";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { settle } from "@/lib/api/part";
import { getPolicyStatus } from "@/lib/api/policy";
import { requireUser } from "@/lib/auth/session";

import { acceptPoliciesAction } from "./actions";

export const metadata = { title: "Terms and Privacy Policy · SME AI Revenue Engine" };
// Per-person data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** Only a path inside the app: where the person was going (`?next=`), else the workspaces. */
const safeNext = (v: string | string[] | undefined): string => {
  const n = Array.isArray(v) ? v[0] : v;
  return typeof n === "string" && /^\/app(\/[A-Za-z0-9._~\-/]*)?$/.test(n) && !n.includes("//") && n.length <= 200 ? n : "/app";
};

/**
 * /app/accept (job CC): where a person accepts a changed Terms or Privacy Policy. Every page that was refused with `policy_acceptance_required` comes here (lib/api/failure.ts: escalate). Not part of a workspace, so it opens
 * for anyone signed in, whatever their role.
 */
export default async function AcceptPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const query = await searchParams;
  const lang = await getLang();
  let status;
  try {
    status = await settle(() => getPolicyStatus(user.accessToken));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const words = wordsFor(lang, ["acpt.", "apierr.", "problem."], ["dta.btn.working"]);
  return (
    <main className={pageMain} lang={lang}>
      <div className="mx-auto max-w-xl">{status.ok ? <AcceptForm words={words} status={status.data} accept={acceptPoliciesAction} next={safeNext(query.next)} /> : <PartProblem kind={status.kind} retryAfter={status.retryAfter} words={words} />}</div>
    </main>
  );
}
