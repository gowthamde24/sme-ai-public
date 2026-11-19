import { daysUntil, textIn, type Festival } from "./templates";

/** What Today needs of the festival calendar: the NEXT festival within a month (today counts), its name in the person's language and the days to go; null when there is no calendar or none ahead (then the suggestion row is not drawn). */
export const FESTIVAL_WINDOW_DAYS = 30;
export type FestivalHint = { season: Festival["season"]; name: string; days: number; date: string };
export function festivalHint(festivals: readonly Festival[] | null, lang: string, now: Date): FestivalHint | null {
  if (!festivals) return null;
  const ahead = festivals
    .map((f) => ({ f, days: daysUntil(f.date, now) }))
    .filter((x) => x.days >= 0 && x.days <= FESTIVAL_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)[0];
  return ahead ? { season: ahead.f.season, name: textIn(ahead.f.name, lang), days: ahead.days, date: ahead.f.date } : null;
}
