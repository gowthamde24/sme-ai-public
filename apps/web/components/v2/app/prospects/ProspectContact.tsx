import Link from "next/link";

import type { Prospect } from "@/lib/lead-finder/types";

import { makeT, type Words } from "../words";

/**
 * What a person can do with a business the Lead Finder found (owner decision, Lead Finder v1.0, 18 Nov 2026): prospects are SHOWN and never called by the assistant. Only two things are offered: "Call from your phone" (a `tel:` link that opens the person's own dialer;
 * no provider, nothing dialled by us) and "Plan a visit". Nothing here starts an AI call, adds to a call list or to a campaign. The assistant only calls people who enquired.
 */
export function telHref(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digits.replace(/\D/g, "").length >= 6 ? `tel:${digits}` : null;
}

export function visitHref(base: string, leadId: string | null): string {
  return leadId ? `${base}/visits?lead=${leadId}` : `${base}/visits`;
}

const link = "inline-flex min-h-11 items-center justify-center rounded-md border-2 border-edge bg-surface px-4 text-base font-bold text-ink hover:bg-surface-2";

export function ProspectContact({ prospect, words, base }: { prospect: Pick<Prospect, "phone" | "leadId">; words: Words; base: string }) {
  const t = makeT(words);
  const tel = telHref(prospect.phone);
  return (
    <span className="flex flex-wrap items-center gap-2" data-part="prospect-contact">
      {tel ? (
        <a href={tel} className={link} data-act="phone">
          {t("lf.v6.call_phone")}
        </a>
      ) : (
        <span className="text-sm text-muted" data-part="prospect-no-phone">
          {t("lf.v6.no_phone")}
        </span>
      )}
      <Link href={visitHref(base, prospect.leadId)} className={link} data-act="visit">
        {t("lf.v6.plan_visit")}
      </Link>
    </span>
  );
}
