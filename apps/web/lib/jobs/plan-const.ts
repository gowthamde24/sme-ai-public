/**
 * The constants of a plan that only the Lead Finder part, the server adapters and the tests use (a file of its own: lib/jobs/plan.ts is part of the New job page's script, which is at its route-JS ceiling).
 * `SEARCH_*`: what a Lead Finder plan may be changed to (`PATCH /jobs/plan/{id}`); `TEMPLATE_ID`: the id of a job template in jobs.json (snake_case, as every pack writes it); `PLAN_BLOCKERS`: what may block a plan (a 200 with `blockers`, never a 422).
 */
export const SEARCH_RESULTS = [5, 10, 20] as const;
export const SEARCH_FIT_BARS = [60, 70, 80, 90] as const;
export const SEARCH_AREA_MAX = 60;
export const TEMPLATE_ID = /^[a-z][a-z0-9_]{0,79}$/;
export const PLAN_BLOCKERS = ["unclear_who", "no_number", "no_whatsapp", "minutes_used", "search_limit", "area_needed"] as const;
