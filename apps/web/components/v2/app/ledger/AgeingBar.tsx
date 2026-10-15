import { formatRupees } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";
import { BUCKETS, share, type Bucket } from "./ledger-logic";

const TONE: Record<Bucket, string> = { d0_30: "bg-green-text", d31_60: "bg-amber-text", d61_90: "bg-red-text", d90_plus: "bg-ink" };

/** What is owed by how old it is (0 to 30, 31 to 60, 61 to 90, over 90 days): a bar and the four amounts. The widths are classes the stylesheet knows (no inline style): the nearest of ten steps. */
export function AgeingBar({ ageing, words }: { ageing: Record<Bucket, number>; words: TodayWords }) {
  const whole = BUCKETS.reduce((a, b) => a + ageing[b], 0);
  const W = ["w-0", "w-[10%]", "w-[20%]", "w-[30%]", "w-[40%]", "w-[50%]", "w-[60%]", "w-[70%]", "w-[80%]", "w-[90%]", "w-full"];
  return (
    <div data-part="ageing" className="flex flex-col gap-2">
      <div role="img" aria-label={say(words, "due.ageing.aria")} className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {BUCKETS.map((b) => (
          <span key={b} className={`${TONE[b]} ${W[Math.round(share(ageing[b], whole) / 10)]}`} />
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
        {BUCKETS.map((b) => (
          <div key={b}>
            <dt className="text-muted">{say(words, `due.ageing.${b}`)}</dt>
            <dd className="font-semibold tabular-nums">{formatRupees(ageing[b])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
