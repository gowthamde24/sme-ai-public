/**
 * Whether an approved quote is past its valid-until date. The database decides the same way: a quote is valid THROUGH its last day, in India (`app.quote_today() > valid_until`: supabase/migrations/20261019090000_order_conversion.sql,
 * lines 726 and 948). The outcome of an expired quote stays `approved`, so the screen has to look at the date itself.
 */
export function indiaDate(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** `validUntil` is the quote's `valid_until`, a calendar date (YYYY-MM-DD). A value that is not one counts as expired: do not offer a chat on a quote whose date cannot be read. */
export function quoteExpired(validUntil: string, now: Date): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || indiaDate(now) > validUntil;
}
