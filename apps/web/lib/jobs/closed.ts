/**
 * The pages that exist only while JOBS is on (planner, 19 Nov 2026): Jobs (list, New job, one job) and What you sell. With JOBS off they must answer a TRUE 404 (HTTP status 404, not the Not found page with 200):
 * these pages have a loading screen, so by the time the page or a layout below it says "not found" the reply has already started with 200. The proxy answers before any page renders (proxy.ts).
 */
const CLOSED = /^\/app\/tenants\/[^/]+\/(?:jobs|what-you-sell)(?:\/|$)/;

/** Is this address one of the pages that exist only while JOBS is on? */
export const isJobsOnlyPath = (pathname: string): boolean => CLOSED.test(pathname);

/** The address that has no page under the same workspace: rewriting to it makes Next draw the workspace's own Not found page with status 404. */
export function notFoundPathOf(pathname: string): string {
  const m = /^(\/app\/tenants\/[^/]+)\//.exec(pathname);
  return `${m ? m[1] : "/app"}/not-found-while-jobs-is-off`;
}
