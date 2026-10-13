/**
 * Reads that do not depend on each other are started together (job CH), and a page then handles each one's failure at the same place, and in the same order, as when they ran one after another:
 *
 *   const [tenantRead, leadRead, evidenceRead] = await Promise.allSettled([fetchTenant(...), fetchLead(...), fetchEvidencePage(...)]);
 *   try { tenant = take(tenantRead); lead = take(leadRead); } catch (error) { ...the page's own handling of a failed tenant or lead... }
 *   try { page = take(evidenceRead); } catch (error) { ...its own handling... }
 *
 * `take` returns the value of a read that worked, and throws the very error of one that failed. A page's `redirect` and `notFound` decisions, and what each section says when its read failed, are exactly what they were; what changes is
 * only that the reads were asked at the same time, so the page waits for the slowest instead of the sum. Nothing here decides who may read what: every read still carries the person's own token, and the API and the database decide.
 */
export function take<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}
