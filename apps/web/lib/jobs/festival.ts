import { daysUntil, textIn, type Festival } from "./templates";

/**
 * What Today needs of the festival calendar: the NEAREST festival only (today counts), its name in the person's language and the days to go; null when there is no calendar or none ahead (then the suggestion row is not drawn).
 * The API sends the next 60 days, nearest first, one row per season (contract 1.1 part 1, section 1 item 7), and the web keeps the same window; the days are counted on the INDIA calendar day (daysUntil), whatever the server's zone.
 */
export const FESTIVAL_WINDOW_DAYS = 60;
export type FestivalHint = { season: Festival["season"]; name: string; days: number; date: string; /** from the sample data (the staging preview, route not there yet) */ sample?: true };
export function festivalHint(festivals: readonly Festival[] | null, lang: string, now: Date): FestivalHint | null {
  if (!festivals) return null;
  const ahead = festivals
    .map((f) => ({ f, days: daysUntil(f.date, now) }))
    .filter((x) => x.days >= 0 && x.days <= FESTIVAL_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)[0];
  return ahead ? { season: ahead.f.season, name: textIn(ahead.f.name, lang), days: ahead.days, date: ahead.f.date, ...(ahead.f.sample ? { sample: true as const } : {}) } : null;
}
