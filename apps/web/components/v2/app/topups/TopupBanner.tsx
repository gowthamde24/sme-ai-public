import Link from "next/link";

import type { UsageView } from "@/lib/topups/types";

import { makeT, type Words } from "../words";
import { alertSentence, topupAlert } from "./alert-text";

/**
 * The notice at 80 and at 100 percent of the minutes or the messages (night 4, part F2), at the top of every screen of the workspace for the people who run it. A SERVER part with no script of its own: nothing is sent to the
 * browser beyond this markup, and nothing at all is drawn while both meters are below 80 percent (or the feature is off: the layout does not even ask). One sentence, with the day it runs out at this pace, and the way to top up
 * (the Owner) or to see the usage (an Admin).
 */
export function TopupBanner({ words, usage, href, canBuy }: { words: Words; usage: UsageView; href: string; canBuy: boolean }) {
  const alert = topupAlert(usage);
  if (!alert) return null;
  const t = makeT(words);
  const stopped = alert.level === 100;
  return (
    <div
      role={stopped ? "alert" : "status"}
      data-topup-banner={alert.level}
      className={`mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 md:px-8 ${stopped ? "border-red-text bg-red-bg text-red-text" : "border-amber-text bg-amber-bg text-amber-text"}`}
    >
      <p className="min-w-0 flex-1 text-sm font-medium">{alertSentence(t, alert)}</p>
      <Link href={href} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold underline underline-offset-2">
        {t(canBuy ? "tu.cta.topup" : "tu.cta.see")}
      </Link>
    </div>
  );
}
