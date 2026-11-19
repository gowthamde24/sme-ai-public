import { fmtMinutes } from "@/lib/jobs/detail";

import type { Say } from "../words";

/** What the Automation page holds while the person is choosing (JOBS): the ten values of the three old forms. The hours and minutes are the strings of the selects. */
export type AutoValues = {
  auto: boolean;
  limit: string;
  quietStart: string;
  quietEnd: string;
  evening: boolean;
  eveningHour: string;
  heads: boolean;
  headsMinutes: string;
  noShow: boolean;
  noShowMinutes: string;
};

/** "9 pm" for an hour of the day. */
export const hourText = (h: number): string => fmtMinutes(h * 60);

/** "1 hour", "2 hours" or "90 minutes". */
export function durText(t: Say, n: number): string {
  if (n % 60 === 0)
    return n === 60
      ? t("jobs.auto.dur.hour")
      : t("jobs.auto.dur.hours", { n: n / 60 });
  return t("jobs.auto.dur.min", { n });
}

/**
 * The "What it will do" lines, worked out from what is chosen right now (so they follow every tap). The examples are made up for the sentence only: an enquiry just before and just after quiet hours start, and a visit tomorrow
 * late enough that its heads-up does not fall in quiet hours. Nothing here is sent or saved.
 */
export function autoEffects(
  v: AutoValues,
  t: Say,
): { quiet: string; visits: string } {
  const qs = Number(v.quietStart);
  const qe = Number(v.quietEnd);
  const start = hourText(qs);
  const end = hourText(qe);
  const quiet = v.auto
    ? t("jobs.auto.fx.quiet.auto", {
        t1: fmtMinutes((qs - 1) * 60 + 15),
        t2: fmtMinutes(qs * 60 + 15),
        end,
      })
    : t("jobs.auto.fx.quiet.off", { start, end });

  const hour = Number(v.eveningHour);
  const mins = Number(v.headsMinutes);
  const parts: string[] = [];
  if (v.evening)
    parts.push(
      hour >= qs
        ? t("jobs.auto.fx.p.evening.clash")
        : t("jobs.auto.fx.p.evening", { h: hourText(hour) }),
    );
  const visit = Math.max(11 * 60, qe * 60 + mins + 30);
  if (v.heads)
    parts.push(t("jobs.auto.fx.p.heads", { h: fmtMinutes(visit - mins) }));
  if (v.noShow)
    parts.push(
      t("jobs.auto.fx.p.noshow", { d: durText(t, Number(v.noShowMinutes)) }),
    );
  const lines =
    parts.length > 0
      ? t("jobs.auto.fx.visit", {
          v: fmtMinutes(visit),
          parts: parts.join(", "),
        })
      : t("jobs.auto.fx.visit.none");
  return {
    quiet,
    visits:
      v.auto || parts.length === 0
        ? lines
        : `${lines} ${t("jobs.auto.fx.visit.needs_on")}`,
  };
}
