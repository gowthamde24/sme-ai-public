import type { AppT } from "@/i18n/app";

import { card, danger, help, primary, secondary, errorLine, okLine } from "../visits/styles";

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
  return (
    <section aria-labelledby="example-h" data-example={state} className={`${card} gap-3 border-brand-edge bg-brand-bg`}>
      <div className="min-w-0">
        <h2 id="example-h" className="font-display text-xl font-semibold leading-tight">
          {state === "loaded" ? t("start.example.loaded.title") : t("start.example.title")}
        </h2>
        <p className={help}>{state === "loaded" ? t("start.example.loaded.body") : t("start.example.body")}</p>
      </div>
      {message}
      {state === "available" ? (
        <form action={load}>
          <button type="submit" className={primary}>
            {t("start.example.load")}
          </button>
        </form>
      ) : (
        <details>
          <summary className={`${secondary} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{t("start.example.remove")}</summary>
          <form action={remove} className="mt-3 flex flex-col items-start gap-3">
            <p className="text-sm">{t("start.example.confirm")}</p>
            <button type="submit" className={danger}>
              {t("start.example.confirm.go")}
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
