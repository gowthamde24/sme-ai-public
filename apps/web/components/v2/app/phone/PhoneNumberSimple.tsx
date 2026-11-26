import type { OwnNumber } from "@/lib/phone-picker/types";

import { makeT, type Words } from "../words";
import { KycPendingNotice } from "./KycPendingNotice";
import { cardBox } from "../Card";

/**
 * The Phone numbers page where there is no picker (owner, 29 Nov 2026: the numbers come from VoiceLink only; no registration, no city to pick, no number to give back): the number the assistant answers, what type it is and
 * whether calls are on, as three open rows; or ONE line, "We set up your number for you." The words come from the string store (`phn.`); the number is shown as `+91 XXXXX XXXXX` and never with a price.
 */
export function PhoneNumberSimple({ words, own, verifyHref }: { words: Words; own: OwnNumber | null; verifyHref?: string }) {
  const t = makeT(words);
  if (!own) {
    return (
      <p data-part="phone-setup" className={`${cardBox} m-0 mt-5 max-w-2xl text-[17px] text-ink`}>
        {t("phn.setup")}
      </p>
    );
  }
  const calls = own.state === "getting_ready" ? "getting" : own.state === "kyc_pending" ? "pending" : own.state === "calls_on" ? "on" : "off";
  return (
    <>
    {own.state === "kyc_pending" && verifyHref ? (
      <div className="mt-5 max-w-2xl">
        <KycPendingNotice words={words} verifyHref={verifyHref} />
      </div>
    ) : null}
    <dl data-part="phone-own" className={`${cardBox} m-0 mt-5 flex max-w-2xl flex-col`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-4">
        <dt className="text-[15px] text-muted">{t("phn.number")}</dt>
        <dd className="m-0 text-[22px] font-semibold tabular-nums text-ink" data-part="my-number">
          {own.display}
        </dd>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-4">
        <dt className="text-[15px] text-muted">{t("phn.type")}</dt>
        <dd className="m-0 text-[17px] font-semibold text-ink" data-part="number-type">
          {t(`pick.type.short.${own.type}` as "pick.type.short.mobile")}
        </dd>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-4">
        <dt className="text-[15px] text-muted">{t("phn.calls")}</dt>
        <dd className="m-0 text-[17px] font-semibold text-ink" data-part="calls-state" data-calls={calls}>
          {t(`phn.calls.${calls}` as "phn.calls.on")}
        </dd>
      </div>
    </dl>
    </>
  );
}
