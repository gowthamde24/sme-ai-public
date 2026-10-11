import { say, type TodayWords } from "../today/today-words";

/** The sentence for a day with no slots, from the API's reason. */
export function closedWord(words: TodayWords, reason: string | null): string {
  const key = reason === "closed_date" ? "visits.closed.date" : reason === "past" ? "visits.closed.past" : reason === "closed_weekday" || reason === "closed_day" ? "visits.closed.weekday" : "visits.closed.other";
  return say(words, key);
}
