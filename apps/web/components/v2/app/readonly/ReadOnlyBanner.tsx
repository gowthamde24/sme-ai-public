import type { Access } from "@/lib/api/billing-access";
import { ADDRESSES } from "@/lib/site/business";

import { alertBox } from "../ui";
import { makeT, type Words } from "../words";

/** "10 Nov 2026" from a plain day (India), in English; the other languages get their own locale's way. */
const dayText = (iso: string, lang: string): string => new Intl.DateTimeFormat(`${lang}-IN`, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));

/**
 * The one explanation on every screen of a read-only workspace (job DP): it says what is switched off, the dates the API gives, and how to go on: write to the billing address, or press the button when the API has a way to
 * pay again (`resume`: the way to the plans, shown when the API says the plan can be paid for again). A server component with no script; the controls themselves are switched off by `ReadOnlyScope`.
 */
export function ReadOnlyBanner({ words, lang, access, resume = null }: { words: Words; lang: string; access: Extract<Access, { readOnly: true }>; resume?: React.ReactNode }) {
  const t = makeT(words);
  return (
    <section role="status" data-readonly-banner data-read-ok aria-labelledby="ro-h" className={`${alertBox} mx-4 mt-4 md:mx-8`}>
      <h2 id="ro-h" className="font-semibold">
        {t("ro.title")}
      </h2>
      <p className="mt-1 text-sm font-normal">{t("ro.body")}</p>
      {access.deleteOn ? <p className="mt-1 text-sm font-normal">{t("plan.readonly.until", { date: dayText(access.deleteOn, lang), n: access.daysLeft ?? 0 })}</p> : null}
      <p className="mt-1 text-sm font-normal">{t("plan.readonly.go", { email: ADDRESSES.billing })}</p>
      {resume}
    </section>
  );
}
