import { fillClass } from "../frame-parts";

/** The height of a column in steps of 5% (a class per step: no inline style, and Tailwind sees every class). */
const HEIGHT: Record<number, string> = { 0: "h-[0%]", 5: "h-[5%]", 10: "h-[10%]", 15: "h-[15%]", 20: "h-[20%]", 25: "h-[25%]", 30: "h-[30%]", 35: "h-[35%]", 40: "h-[40%]", 45: "h-[45%]", 50: "h-[50%]", 55: "h-[55%]", 60: "h-[60%]", 65: "h-[65%]", 70: "h-[70%]", 75: "h-[75%]", 80: "h-[80%]", 85: "h-[85%]", 90: "h-[90%]", 95: "h-[95%]", 100: "h-[100%]" };
const heightClass = (percent: number): string => HEIGHT[Math.min(100, Math.max(0, Math.round(percent / 5) * 5))];

/** A share of `max` as a whole percent; a value above zero never draws as an empty bar. */
export function share(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(5, Math.min(100, (value / max) * 100));
}

type Tone = "brand" | "green" | "amber" | "red" | "muted";
const FILL: Record<Tone, string> = { brand: "bg-brand", green: "bg-green-text", amber: "bg-amber-text", red: "bg-red-text", muted: "bg-muted" };

/**
 * One line of a bar chart: the name and the number in words on one line (so the number is never only a length), the bar full width under them. Reads well at 360 px: nothing sits beside the bar.
 */
export function BarRow({ label, value, max, tone = "brand", text }: { label: string; value: number; max: number; tone?: Tone; text?: string }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words text-base">{label}</span>
        <span className="shrink-0 font-display text-xl font-bold">{text ?? value}</span>
      </div>
      <div aria-hidden="true" className="h-3 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${FILL[tone]} ${fillClass(share(value, max))}`} />
      </div>
    </li>
  );
}

/** Seven columns (a week by day). The numbers are written above the columns; the whole chart is one image for a screen reader with `aria` saying every value. */
export function DayColumns({ days, aria }: { days: readonly { label: string; value: number }[]; aria: string }) {
  const max = Math.max(0, ...days.map((d) => d.value));
  return (
    <div role="img" aria-label={aria} className="grid grid-cols-7 gap-1.5 sm:gap-3">
      {days.map((d, i) => (
        <div key={i} aria-hidden="true" className="flex min-w-0 flex-col items-center gap-1">
          <span className="text-sm font-semibold">{d.value}</span>
          <div className="flex h-28 w-full items-end overflow-hidden rounded-md bg-surface-2">
            <div className={`w-full rounded-md bg-brand ${heightClass(share(d.value, max))}`} />
          </div>
          <span className="max-w-full truncate text-sm text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
