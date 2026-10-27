import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { V3Section } from "@/components/v2/site/PackSections";
import { linkQuiet } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import { packFlowKeys } from "@/lib/site/lead-desk";
import { sitePath } from "@/lib/site/paths";

/**
 * "How Lead Desk works for <this business>" on a business type's page (night 4, F1): a short numbered flow from the first enquiry to the visit, quote or booking, and for a school the plain note that the assistant never talks about
 * fees, marks or dues. The words are `ld.pack.<id>.*` in site.json, listed in lib/site/lead-desk.ts; a business type without them gets no block. Server markup only. Links only to the plans page, which every mode serves.
 */
export function PackLeadDesk({ packId, t, lang }: { packId: string; t: SiteT; lang: Lang }) {
  const keys = packFlowKeys(packId);
  if (!keys) return null;
  return (
    <V3Section id="lead-desk" title={t(keys.title)} tone="mist">
      <ol className="m-0 grid list-none gap-0 border-t border-line p-0 md:grid-cols-2 lg:grid-cols-4" data-part="ld-flow" data-pack={packId}>
        {keys.steps.map((k, i) => (
          <li key={k} className="border-b border-line py-7 md:pr-7">
            <span aria-hidden="true" className="font-display text-4xl font-extrabold leading-none tracking-[-0.025em] text-brand-text">
              {i + 1}
            </span>
            <p className="mt-3 text-[17px]">{t(k)}</p>
          </li>
        ))}
      </ol>
      {keys.note ? (
        <p className="mt-8 max-w-3xl border-l-4 border-brand-text pl-4 text-[17px] font-semibold text-ink" data-part="ld-note">
          {t(keys.note)}
        </p>
      ) : null}
      <p className="mt-6">
        <Link href={sitePath(lang, { kind: "page", page: "pricing" })} className={linkQuiet}>
          {t("ld.pack.plans")}
          <ArrowRight className="ml-1 size-4" aria-hidden="true" />
        </Link>
      </p>
    </V3Section>
  );
}
