import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

/**
 * PREVIEW JOBS (planner, 19 Nov 2026; real data and the sample-business picker, 20 Nov): on STAGING only, one browser can look at the JOBS and BILLING_V2 screens without changing anything for anyone else.
 *  - `PREVIEW_JOBS=1` is the switch of the ENVIRONMENT (deploy/staging-web-flags.env). Production never sets it: without it the cookie is IGNORED (tests: preview.test.ts, deploy.test.ts).
 *  - The person's choice is the cookie `s19_preview` (httpOnly), set by the page /app/preview. Its value is `jobs` or `jobs:<sample business>`:
 *      `jobs`               = MY BUSINESS (the default): the screens call the real routes of the signed-in workspace (the flags answer "on", as if JOBS=1 and BILLING_V2=1); a part whose route is still 404 shows the sample data, marked "Sample".
 *      `jobs:saree|realestate|school|cars` = a SAMPLE BUSINESS: full mock mode (the flags answer "mock") with that business type's sample data, never mixed with real data.
 *    Anything else (another word, an unknown sample word after `jobs:`) is read as the default or as "not previewing": an unknown value never turns a sample on.
 *  - The flags are read in about a hundred places, all synchronous, and Next 16 reads cookies only asynchronously: so the cookie is read from the request's own store (the one `cookies()` itself reads), with no await.
 *    Outside a request (tests, build) there is no store and the answer is "not previewing". Any surprise here (a different Next version) is read as "not previewing", never an error.
 */
export const PREVIEW_COOKIE = "s19_preview";
export const PREVIEW_VALUE = "jobs";

/** The sample businesses of the picker: a closed list of words (the cookie value is `jobs:<word>`). `saree` is the demo shop the mock always was (Neelambari Silks). */
export const SAMPLE_TYPES = ["saree", "realestate", "school", "cars"] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

/** What the person chose: their own business (real data where it exists) or one sample business (full mock). */
export type PreviewChoice = { kind: "mine" } | { kind: "sample"; type: SampleType };

/** The picker's words: `mine` or one sample word. */
export const PICKER_WORDS = ["mine", ...SAMPLE_TYPES] as const;
export type PickerWord = (typeof PICKER_WORDS)[number];

/** The cookie value of a choice. */
export const previewValue = (choice: PreviewChoice): string => (choice.kind === "sample" ? `${PREVIEW_VALUE}:${choice.type}` : PREVIEW_VALUE);

/** The picker word of a choice (the select's value). */
export const pickerWordOf = (choice: PreviewChoice | null): PickerWord => (choice?.kind === "sample" ? choice.type : "mine");

/** A word of the picker (a form field) as a choice: an unknown word is "my business", the default. */
export function choiceOfWord(word: unknown): PreviewChoice {
  const type = SAMPLE_TYPES.find((t) => t === word);
  return type ? { kind: "sample", type } : { kind: "mine" };
}

/** The cookie value as a choice: `jobs` and `jobs:<unknown word>` are "my business" (the default), `jobs:<sample word>` that sample, anything else is no preview (null). */
export function parsePreview(value: string | undefined): PreviewChoice | null {
  if (typeof value !== "string") return null;
  if (value === PREVIEW_VALUE) return { kind: "mine" };
  if (!value.startsWith(`${PREVIEW_VALUE}:`)) return null;
  return choiceOfWord(value.slice(PREVIEW_VALUE.length + 1));
}

/** Is this environment allowed to preview at all (staging)? */
export const previewAllowed = (value: string | undefined = process.env.PREVIEW_JOBS): boolean => value === "1";

/** What THIS request chose, or null: never in an environment that does not allow it. */
export function previewChoice(): PreviewChoice | null {
  if (!previewAllowed()) return null;
  try {
    const store = workUnitAsyncStorage.getStore();
    return store?.type === "request" ? parsePreview(store.cookies.get(PREVIEW_COOKIE)?.value) : null;
  } catch {
    return null;
  }
}

/** Is THIS request previewing (either choice)? */
export const previewOn = (): boolean => previewChoice() !== null;
/** Previewing MY business: the real routes, with the sample data only where a route is still 404. */
export const previewMine = (): boolean => previewChoice()?.kind === "mine";
/** Previewing one SAMPLE business (full mock): which one, else null. */
export function previewSample(): SampleType | null {
  const c = previewChoice();
  return c?.kind === "sample" ? c.type : null;
}

/** What the two flags answer while previewing, as the words of the environment variables they read: `1` (the real routes) for my business, `mock` for a sample business; nothing when not previewing (the environment's own value decides). */
export function previewMode(): "1" | "mock" | undefined {
  const c = previewChoice();
  return c === null ? undefined : c.kind === "mine" ? "1" : "mock";
}
