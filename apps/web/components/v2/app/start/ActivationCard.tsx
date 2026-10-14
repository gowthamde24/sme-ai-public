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
export function ActivationCard({ activation, base, t }: { activation: Activation; base: string; t: AppT }) {
  if (activation.steps.length === 0 || activation.done === activation.total) return null;
  const next = activation.next;
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
              <span className="text-sm text-muted">{s.state === "done" ? t("start.step.done") : s.state === "unavailable" ? t("start.step.unavailable") : t("start.step.todo")}</span>
              {s.href && s.state === "todo" ? <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden="true" /> : null}
            </>
          );
          const cls = "flex min-h-11 w-full items-center gap-3 rounded-lg px-1 py-1 text-left text-base";
          return (
            <li key={s.id} data-step={s.id} data-state={s.state}>
              {s.href && s.state === "todo" ? (
                <Link href={`${base}${s.href}`} className={`${cls} hover:bg-surface-2`}>
                  {body}
                </Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {next?.href ? (
        <div>
          <Link href={`${base}${next.href}`} className={primary}>
            {t("start.next")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
