import { Check, ChevronRight, Circle, Clock } from "lucide-react";
import Link from "next/link";

import type { AppT } from "@/i18n/app";
import type { Activation } from "@/lib/packs/activation";

import { card, primary } from "../visits/styles";

/**
 * The activation checklist at the top of Today for a business type that has one (job CL, blueprint 3.3): what to do first, in order, each step answered by a REAL fact from the backend. A server component with no script
 * (the questions are asked on the Start page, one at a time, when the person gets to them: progressive profiling). A step whose screen is not built yet says "Not available yet" and is never shown as done. It disappears when
 * every step is done: that is "activated". `base` = `/app/tenants/<id>`.
 */
/** A step inside the workspace is relative to it; an account page (a path that starts with /app) is used as it is. */
const hrefOf = (base: string, href: string) => (href.startsWith("/app") ? href : `${base}${href}`);

export function ActivationCard({ activation, base, t, hide = null, hidden = [], collapse = false }: { /** On Today: five or more steps done fold the card into one row (Settings always lists the steps). */ collapse?: boolean; activation: Activation; base: string; t: AppT; /** The server action that puts a step away from Today (or brings it back): with it each step still to do has "Hide for now" (and a hidden one "Show on Today"). */ hide?: ((formData: FormData) => Promise<void>) | null; /** The steps put away from Today (the Settings list shows them marked and with the way back). */ hidden?: readonly string[] }) {
  if (activation.steps.length === 0 || activation.done === activation.total) return null;
  const next = activation.next;
  // five or more of the steps done (owner review, 1 Nov): the card folds into ONE row, "Finish setting up · 5 of 6 · Continue"
  if (collapse && activation.done >= 5)
    return (
      <section aria-labelledby="start-h" data-start="card" data-collapsed="true" className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-[20px] border border-line bg-surface px-4 py-2">
        <h2 id="start-h" className="font-display text-base font-semibold leading-tight">
          {t("start.title")}
        </h2>
        <p className="text-sm text-muted">· {t("start.count", { done: activation.done, total: activation.total })}</p>
        {next?.href ? (
          <Link href={hrefOf(base, next.href)} className="ml-auto inline-flex min-h-9 items-center rounded-full border border-brand-edge bg-brand px-4 text-sm font-bold whitespace-nowrap text-on-brand hover:brightness-95">
            {t("start.next")}
          </Link>
        ) : null}
      </section>
    );
  return (
    <section aria-labelledby="start-h" data-start="card" className={`${card} gap-3`}>
      <div className="min-w-0">
        <h2 id="start-h" className="font-display text-xl font-semibold leading-tight">
          {t("start.title")}
        </h2>
        <p className="text-sm text-muted">{t("start.count", { done: activation.done, total: activation.total })}</p>
      </div>
      <ul className="flex flex-col">
        {activation.steps.map((s) => {
          const body = (
            <>
              {s.state === "done" ? <Check className="size-5 shrink-0 text-green-text" aria-hidden="true" /> : s.state === "unavailable" ? <Clock className="size-5 shrink-0 text-muted" aria-hidden="true" /> : <Circle className="size-5 shrink-0 text-muted" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className={`block ${s.state === "done" ? "text-muted line-through" : "font-medium"}`}>{s.title}</span>
                {s.state === "todo" ? <span className="block text-sm text-muted">{s.hint}</span> : null}
              </span>
              <span className="order-last basis-full pl-8 text-sm text-muted sm:order-none sm:basis-auto sm:pl-0 sm:whitespace-nowrap">{s.state === "done" ? t("start.step.done") : s.state === "unavailable" ? t("start.step.unavailable") : t("start.step.todo")}</span>
              {s.href && s.state === "todo" ? <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden="true" /> : null}
            </>
          );
          // narrow screens (owner, 30 Oct): the icon, the title with its hint and the arrow share the first line, the status sits under the title; from `sm` up it is one line as before
          const cls = "flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-0 rounded-lg px-1 py-1 text-left text-base sm:flex-nowrap";
          const away = hidden.includes(s.id);
          return (
            <li key={s.id} data-step={s.id} data-state={s.state} data-hidden={away ? "true" : undefined} className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
              <div className="min-w-0 flex-1">
                {s.href && s.state === "todo" ? (
                  <Link href={hrefOf(base, s.href)} className={`${cls} hover:bg-surface-2`}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
                {away ? <span className="block pl-9 text-sm text-muted">{t("start.hidden")}</span> : null}
              </div>
              {hide && s.state === "todo" ? (
                <form action={hide} className="pl-9 sm:pl-0">
                  <input type="hidden" name="step" value={s.id} />
                  {away ? <input type="hidden" name="do" value="show" /> : null}
                  <button type="submit" className="-ml-3 inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-2 sm:ml-0">
                    {away ? t("start.show") : t("start.hide")}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {next?.href ? (
        <div>
          <Link href={hrefOf(base, next.href)} className={primary}>
            {t("start.next")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
