import Link from "next/link";

import { makeT, type Words } from "../words";

/** A number bought but not active until the business is verified (C1's `kyc_pending`): the neutral notice (a dot and one grey sentence) with the way to the Verify page. */
export function KycPendingNotice({ words, verifyHref }: { words: Words; verifyHref: string }) {
  const t = makeT(words);
  return (
    <p role="status" data-part="kyc-pending" className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-line py-3 text-[15px] text-muted">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-brand" />
      <span>{t("phn.kyc.pending")}</span>
      <Link href={verifyHref} className="min-h-11 content-center font-semibold text-ink underline underline-offset-4">
        {t("phn.kyc.go")}
      </Link>
    </p>
  );
}
