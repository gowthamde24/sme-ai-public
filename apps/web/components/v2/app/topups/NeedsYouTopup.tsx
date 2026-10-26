import Link from "next/link";

import { dayLabel } from "@/lib/topups/logic";
import type { UsageView } from "@/lib/topups/types";

import { btnMain, btnQuiet } from "../ui";
import { makeT, type Words } from "../words";
import { SHORT, topupAlert } from "./alert-text";

/**
 * The "Needs you" card for the minutes or messages running out (night 4, part F2), drawn on Today above the day's cards; the API writes the same thing as a Needs-you item (kind topup_low at 80 percent, topup_empty at 100) and
 * the Owner also gets a WhatsApp note and an e-mail. A SERVER part: a title, what it means, the day it runs out at this pace, and one button. Nothing is drawn below 80 percent.
 */
export function NeedsYouTopup({ words, usage, href, canBuy }: { words: Words; usage: UsageView; href: string; canBuy: boolean }) {
  const alert = topupAlert(usage);
  if (!alert) return null;
  const t = makeT(words);
  const short = SHORT[alert.kind];
  const stopped = alert.level === 100;
  const run = alert.meter.projectedRunOutOn;
  return (
    <section aria-labelledby="tu-needs-h" data-topup-needs={alert.level} className="mb-6 flex flex-col gap-2 rounded-[20px] border border-line bg-surface p-4 md:p-5">
      <p className={`w-fit rounded-full px-2.5 py-1 text-sm font-semibold ${stopped ? "bg-red-bg text-red-text" : "bg-amber-bg text-amber-text"}`}>{t("tu.needs.badge")}</p>
      <h2 id="tu-needs-h" className="font-display text-xl font-semibold">
        {t(`tu.needs.${stopped ? "empty" : "low"}.${short}`)}
      </h2>
      <p className="text-base">{t(`tu.needs.body.${stopped ? "100" : "80"}.${short}`, { n: stopped ? alert.meter.queued : (alert.meter.percent ?? 80) })}</p>
      {!stopped && run ? <p className="text-sm text-muted">{t("tu.alert.runout", { date: dayLabel(run) })}</p> : null}
      <div>
        <Link href={href} className={canBuy ? btnMain : btnQuiet}>
          {t(canBuy ? "tu.cta.topup" : "tu.cta.see")}
        </Link>
      </div>
    </section>
  );
}
