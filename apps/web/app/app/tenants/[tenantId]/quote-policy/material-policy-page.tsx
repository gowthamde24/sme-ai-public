import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { PolicyForm } from "@/components/v2/app/materials/PolicyForm";
import { PolicySummary } from "@/components/v2/app/materials/PolicySummary";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { link, noteBox, okBox, pageH1, pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { getMaterialPolicy } from "@/lib/api/materials";

import { quoteWords } from "../quotes/material-words";
import { saveMaterialPolicyAction } from "./material-policy-actions";
import type { Lang } from "@/i18n/lang";

/** The quote rules of a business that sells building materials (job CO): the rules in force, and (for the Owner, with the authenticator app) the form to publish a new version. */
export async function MaterialPolicyPage({ accessToken, tenantId, role, aal2, lang, saved }: { accessToken: string; tenantId: string; role: "owner" | "admin" | "sales" | "viewer"; aal2: boolean; lang: Lang; saved: boolean }) {
  const words = quoteWords(lang);
  if (role === "viewer") return <main className={pageMain} lang={lang}><h1 className={pageH1}>{words["mat.pol.title"]}</h1><p className="mt-2 text-sm text-muted">{words["mat.q.viewer"]}</p></main>;
  let policy;
  try {
    policy = await getMaterialPolicy(accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const base = `/app/tenants/${tenantId}`;
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{words["mat.pol.title"]}</h1>
      <p className="mb-4 text-base text-muted">{words["mat.pol.sub"]}</p>
      {saved ? <p role="status" className={okBox}>{words["mat.pol.saved"]}</p> : null}
      <div className="flex flex-col gap-5">
        <PolicySummary policy={policy} words={words} />
        {role !== "owner" ? (
          <p role="note" className={noteBox}>{words["mat.pol.owneronly"]}</p>
        ) : !aal2 ? (
          <p role="note" className={noteBox}>{words["mat.pol.2fa"]} <Link href="/app/security" className={link}>{words["today.err.mfa.link"]}</Link></p>
        ) : (
          <section aria-labelledby="mat-pol-new" className="flex flex-col gap-3">
            <h2 id="mat-pol-new" className="font-display text-xl font-bold">{words["mat.pol.new"]}</h2>
            <PolicyForm base={base} versionId={randomUUID()} current={policy.current?.policy ?? null} words={words} save={saveMaterialPolicyAction.bind(null, tenantId)} />
          </section>
        )}
      </div>
    </main>
  );
}
