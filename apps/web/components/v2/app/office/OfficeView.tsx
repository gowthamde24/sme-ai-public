import { ArrowRight, Armchair } from "lucide-react";
import Link from "next/link";

import { pageH1 } from "../ui";
import { ago } from "../today/TodayView";
import type { AgentRow, T } from "../today/types";

const card = "rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]";
const pill = "inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold";
const STATE_PILL = { working: "border-brand-edge bg-brand-bg text-brand-text", idle: "border-line bg-surface-2 text-muted", not_available: "border-line bg-surface-2 text-ink", switched_off: "border-amber-text bg-amber-bg text-amber-text" } as const;

/**
 * The Office as a list (the 3D room is a later batch): one card per agent with its state and what it is doing, and, beside them, the chosen agent's latest events. `agents` are the
 * rows of `getAgentsStatus()` (Job AD, always all seven); null = they cannot be read and the screen says "Not available yet" (it names no agent it cannot verify). A helper that is `not_available` is one that is not built: it says so. The chosen agent is `?agent=` (a real link).
 * "Runs and cost" is the existing page of agent runs.
 */
export function OfficeView({ agents, selected, base, t }: { agents: AgentRow[] | null; selected: string | null; base: string; t: T }) {
  const chosen = agents?.find((a) => a.agent === selected) ?? null;
  const stateText = (a: AgentRow) => (a.state === "working" ? t("office.working") : a.state === "idle" ? t("office.idle") : a.state === "switched_off" ? t("office.switchedoff") : t("frame.notyet"));
  return (
    <div data-screen="office">
      <header>
        <h1 className={pageH1}>{t("office.title")}</h1>
        <p className="text-base text-muted">{t("office.sub")}</p>
      </header>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section aria-label={t("office.title")} className="lg:col-span-8">
          {agents === null ? (
            <div className={`${card} flex items-center gap-3`}>
              <Armchair className="size-6 shrink-0 text-muted" aria-hidden="true" />
              <p className="text-base text-muted">{t("frame.notyet")}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {agents.map((a) => (
                <li key={a.agent}>
                  <Link href={`${base}/office?agent=${encodeURIComponent(a.agent)}`} aria-current={a.agent === selected ? "true" : undefined} className={`${card} flex min-h-24 flex-col gap-1 hover:border-edge ${a.agent === selected ? "border-brand-edge ring-2 ring-brand-edge" : ""}`}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-display text-lg font-semibold">{t(`agent.${a.agent}`)}</span>
                      <span className={`${pill} ${STATE_PILL[a.state]}`}>{stateText(a)}</span>
                    </span>
                    <span className="text-base">{a.job}</span>
                    {a.last_event ? <span className="line-clamp-2 text-sm text-muted">{`${a.last_event.text} · ${ago(a.last_event.at)}`}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="space-y-4 lg:col-span-4">
          <section aria-labelledby="latest-heading" className={card}>
            {chosen ? (
              <>
                <h2 className="font-display text-xl font-semibold">{t(`agent.${chosen.agent}`)}</h2>
                <p className="mt-1 text-base">{chosen.job}</p>
                <h3 id="latest-heading" className="mt-3 text-sm font-semibold">
                  {t("office.latest")}
                </h3>
                <p className="mt-1 text-base">{chosen.last_event ? `${chosen.last_event.text} · ${ago(chosen.last_event.at)}` : t("office.noevents")}</p>
              </>
            ) : (
              <p id="latest-heading" className="text-base text-muted">
                {t("office.pick")}
              </p>
            )}
          </section>
          <Link href={`${base}/agents`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-base font-semibold text-brand-text hover:underline">
            {t("office.runs")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
