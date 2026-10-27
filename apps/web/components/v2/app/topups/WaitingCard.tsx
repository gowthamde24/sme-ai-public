import Link from "next/link";

import { makeT, type Words } from "../words";

/**
 * "12 leads waiting for calls · Top up" (night 4, part F2): drawn on Today and on the plans page while calls wait for minutes. A SERVER part. It says what is true meanwhile: the calls are queued and start again by themselves
 * after a top-up or when the new month begins, the leads are still captured, and the free WhatsApp replies inside 24 hours go on. Nothing is drawn when no call waits.
 */
export function WaitingCard({ words, waiting, href, canBuy }: { words: Words; waiting: number; href: string; canBuy: boolean }) {
  if (waiting <= 0) return null;
  const t = makeT(words);
  return (
    <section aria-labelledby="tu-wait-h" data-topup-waiting={waiting} className="mb-6 rounded-[20px] border border-amber-text bg-amber-bg p-4 text-amber-text md:p-5">
      <h2 id="tu-wait-h" className="font-display text-xl font-semibold">
        {waiting === 1 ? t("tu.wait.title.one") : t("tu.wait.title", { n: waiting })}
        {" · "}
        <Link href={href} className="underline underline-offset-2">
          {t(canBuy ? "tu.cta.topup" : "tu.cta.see")}
        </Link>
      </h2>
      <p className="mt-1 text-sm">{t("tu.wait.body")}</p>
    </section>
  );
}
