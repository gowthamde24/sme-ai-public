import Link from "next/link";
import { redirect } from "next/navigation";

import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { fetchQuotePolicyVersions, type QuotePolicyVersion } from "@/lib/api/quote-policies";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { ApiDownV2 } from "@/components/v2/app/parts";
import { AddButton } from "@/components/v2/app/AddButton";
import { link, mutedText, noteBox, spaceTop } from "@/components/v2/app/ui";
import { makeT } from "@/components/v2/app/words";
import { partsWords } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { wordsFor } from "@/i18n/app-words";

import { todayInIndia } from "../followups/page-parts";
import { MaterialPolicyPage } from "./material-policy-page";
import { publishQuotePolicyAction } from "./quote-policy-actions";
import { QuotePolicyForm } from "./quote-policy-form";
import { QuotePolicyView } from "./quote-policy-view";

const ROLES = ["owner", "admin"];

/**
 * The quote policy as the "Quotes" part of Settings (owner, 15 Nov 2026: Settings, Quotes; the old address /quote-policy goes here): the published policy versions and, for an owner or an admin with the authenticator app,
 * the form to publish a new one. A business that sells by area, weight or piece (module `materials`) gets its own rules in the same place. Every other role gets one plain sentence and nothing else. Server side only;
 * the page that draws it has already read the person's role. The form gets ONE new id per render.
 */
export async function QuotePolicySection({ accessToken, tenantId, role, secondFactorMissing, lang, saved }: { accessToken: string; tenantId: string; role: "owner" | "admin" | "sales" | "viewer"; secondFactorMissing: boolean; lang: Lang; saved: boolean }) {
  if (hasModule(await readPackCached(accessToken, tenantId).catch(() => null), "materials")) {
    return MaterialPolicyPage({ accessToken, tenantId, role, aal2: !secondFactorMissing, lang, saved, embedded: true });
  }
  const words = wordsFor(lang, ["qp."]);
  const t = makeT(words);
  if (!ROLES.includes(role))
    return (
      <section aria-labelledby="quote-policy-heading">
        <h2 id="quote-policy-heading" className="font-display text-xl font-semibold">
          {t("qp.the_quote_policy")}
        </h2>
        <p className={mutedText}>{t("qp.only_an_owner_or_an_admin")}</p>
      </section>
    );
  let versions: QuotePolicyVersion[];
  try {
    versions = await fetchQuotePolicyVersions(accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const today = todayInIndia(new Date());
  // A new version cannot start before today or before the newest published version (the database decides again).
  const newest = versions.reduce((latest, v) => (v.effective_from > latest ? v.effective_from : latest), "");
  const minDate = newest > today ? newest : today;
  const form = secondFactorMissing ? (
    <p role="note" className={noteBox}>
      {t("qp.mfa_publishing")}{" "}
      <Link href="/app/security" className={link}>
        {t("qp.set_it_up_on_the_security")}
      </Link>
      {t("qp.mfa_b")}
    </p>
  ) : (
    <div className={spaceTop}>
      <AddButton label={t("qp.publish_a_new_version")}>
        <QuotePolicyForm action={publishQuotePolicyAction.bind(null, tenantId)} policyId={crypto.randomUUID()} today={today} minDate={minDate} />
      </AddButton>
    </div>
  );
  return <QuotePolicyView words={words} versions={versions} today={today} form={form} embedded />;
}
