import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

/**
 * PREVIEW JOBS (planner, 19 Nov 2026): on STAGING only, one browser can look at the JOBS and BILLING_V2 screens with sample data (mock mode) without changing anything for anyone else.
 *  - `PREVIEW_JOBS=1` is the switch of the ENVIRONMENT (deploy/staging-web-flags.env). Production never sets it: without it the cookie is IGNORED (tests: preview.test.ts, deploy.test.ts).
 *  - The person's choice is the cookie `s19_preview=jobs` (httpOnly), set by the page /app/preview. While it is there, `jobsScreens()` and `billingV2()` answer "mock" for THAT request only.
 *  - The flags are read in about a hundred places, all synchronous, and Next 16 reads cookies only asynchronously: so the cookie is read from the request's own store (the one `cookies()` itself reads), with no await.
 *    Outside a request (tests, build) there is no store and the answer is "not previewing". Any surprise here (a different Next version) is read as "not previewing", never an error.
 */
export const PREVIEW_COOKIE = "s19_preview";
export const PREVIEW_VALUE = "jobs";

/** Is this environment allowed to preview at all (staging)? */
export const previewAllowed = (value: string | undefined = process.env.PREVIEW_JOBS): boolean => value === "1";

/** Is THIS request previewing? Never in an environment that does not allow it. */
export function previewOn(): boolean {
  if (!previewAllowed()) return false;
  try {
    const store = workUnitAsyncStorage.getStore();
    return store?.type === "request" && store.cookies.get(PREVIEW_COOKIE)?.value === PREVIEW_VALUE;
  } catch {
    return false;
  }
}

/** What the two flags answer while previewing (`mock`), else nothing (the environment's own value decides). */
export const previewMode = (): "mock" | undefined => (previewOn() ? "mock" : undefined);
