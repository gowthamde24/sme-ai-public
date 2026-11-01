import type { AppT } from "@/i18n/app";

import { danger, errorLine, okLine } from "../visits/styles";

export type ExampleState = "available" | "loaded";
export type ExampleNotice = "loaded" | "removed" | "unavailable" | "failed" | null;

/**
 * "See how it works with example data" (job CL, blueprint 3.2): a banner at the top of Today. One press loads a small sample workspace that is clearly labelled as example; another removes it (after one confirming
 * press: it deletes rows, and only the sample's own rows that nobody has used; the others stay, and `kept` says how many). Two plain forms posting to server actions: no script. Drawn only when the server can say whether a
 * sample is loaded; nothing is invented. `notice` = the result of the last press (carried in the address by the action).
 */
export function ExampleBanner({ state, notice, kept = 0, load, remove, t }: { state: ExampleState; notice: ExampleNotice; /** How many sample rows stayed because they were used (with `removed`). */ kept?: number; load: () => Promise<void>; remove: () => Promise<void>; t: AppT }) {
  const message =
    notice === "loaded" ? (
      <p role="status" className={okLine}>
        {t("start.example.done.loaded")}
      </p>
    ) : notice === "removed" ? (
      <p role="status" className={okLine}>
        {kept > 0 ? t("start.example.done.kept", { n: kept }) : t("start.example.done.removed")}
      </p>
    ) : notice === "unavailable" ? (
      <p role="alert" className={errorLine}>
        {t("start.example.unavailable")}
      </p>
    ) : notice === "failed" ? (
      <p role="alert" className={errorLine}>
        {t("start.example.failed")}
      </p>
    ) : null;
  // ONE slim line under the greeting (owner review, 1 Nov), not a card: the words and one link; "Remove" opens its one confirming step right there
  const line = "flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted";
  const link = "inline-flex min-h-9 cursor-pointer items-center font-semibold text-brand-text hover:underline [&::-webkit-details-marker]:hidden";
  return (
    <section aria-labelledby="example-h" data-example={state} className="flex flex-col gap-1">
      {state === "available" ? (
        <form action={load} className={line}>
          <h2 id="example-h" className="font-semibold text-ink">
            {t("start.example.title")}
          </h2>
          <span aria-hidden="true" className="max-sm:hidden">·</span>
          <button type="submit" className={link}>
            {t("start.example.load")}
          </button>
        </form>
      ) : (
        <details>
          <summary className={`${line} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            <h2 id="example-h" className="font-semibold text-ink">
              {t("start.example.loaded.title")}
            </h2>
            <span aria-hidden="true" className="max-sm:hidden">·</span>
            <span className="font-semibold text-brand-text hover:underline">{t("start.example.remove")}</span>
          </summary>
          <form action={remove} className="mt-1 flex flex-wrap items-center gap-3">
            <p className="text-sm">{t("start.example.confirm")}</p>
            <button type="submit" className={danger}>
              {t("start.example.confirm.go")}
            </button>
          </form>
        </details>
      )}
      {message}
    </section>
  );
}
