import { schedulerView } from "../outbox/scheduler-line";
import { indiaClock } from "../today/time";
import { say, type TodayWords } from "../today/today-words";
import { card } from "../visits/styles";
import type { OutboxSettings } from "@/lib/api/outbox";
import type { SchedulerStatus } from "@/lib/api/scheduler";

/** The system-wide sending switch (the operator's): read only here. Off = nothing goes out, everything waits. null = could not be read. */
export function SystemSwitchCard({ words, settings }: { words: TodayWords; settings: OutboxSettings | null }) {
  return (
    <section aria-labelledby="system-heading" className={card} data-card="system-switch">
      <h2 id="system-heading" className="font-display text-xl font-semibold">
        {say(words, "agentset.system.title")}
      </h2>
      {settings === null ? (
        <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
      ) : (
        <>
          <p className={`inline-flex w-fit rounded-full px-3 py-1 text-base font-semibold ${settings.platform_switch_on ? "bg-green-bg text-green-text" : "bg-amber-bg text-amber-text"}`}>{say(words, settings.platform_switch_on ? "agentset.system.on" : "agentset.system.off")}</p>
          <p className="text-sm text-muted">{say(words, settings.platform_switch_on ? "agentset.system.on.note" : "agentset.system.off.note")}</p>
        </>
      )}
    </section>
  );
}

/** Agent OWL's scheduler (job AW): is it working, when it last checked and when it checks next, and what it did today (counts only). A calm warning when it should be working and has not run for five minutes. */
export function SchedulerCard({ words, status, now }: { words: TodayWords; status: SchedulerStatus | null; now: number }) {
  const v = status ? schedulerView(status, now) : null;
  return (
    <section aria-labelledby="sched-heading" className={card} data-card="scheduler">
      <h2 id="sched-heading" className="font-display text-xl font-semibold">
        {say(words, "agentset.sched.title")}
      </h2>
      {status === null || v === null ? (
        <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
      ) : (
        <>
          {v.state === "stale" ? (
            <p role="status" data-scheduler="stale" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
              {say(words, "outbox.sched.stale", { minutes: v.minutes })}
            </p>
          ) : null}
          <p data-line="releases-approved" className="rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm font-medium">
            {say(words, status.releases_approved ? "agentset.sched.approved" : "agentset.sched.approved.no")}
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">{say(words, "agentset.sched.state")}</dt>
              <dd className="font-semibold">{say(words, status.active ? "agentset.sched.active" : status.platform_switch_on ? "agentset.sched.off.business" : "agentset.sched.off.system")}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{say(words, "agentset.sched.last")}</dt>
              <dd className="font-semibold tabular-nums">{v.state === "never" ? say(words, "agentset.sched.never") : v.minutes < 1 ? say(words, "agentset.sched.justnow") : say(words, "agentset.sched.minago", { minutes: v.minutes })}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{say(words, "agentset.sched.next")}</dt>
              <dd className="font-semibold tabular-nums">{status.next_run_at && Date.parse(status.next_run_at) > now ? indiaClock(status.next_run_at) : "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{say(words, "agentset.sched.activity")}</dt>
              <dd className="font-semibold tabular-nums">{status.last_activity_at ? indiaClock(status.last_activity_at) : "—"}</dd>
            </div>
          </dl>
          <div>
            <p className="mb-1.5 text-sm font-semibold">{say(words, "agentset.sched.today")}</p>
            <ul className="flex flex-wrap gap-2 text-sm">
              {(["sent", "reminders", "no_shows", "failed", "errors"] as const).map((k) => (
                <li key={k} className="rounded-full bg-surface-2 px-3 py-1.5 font-medium">
                  {say(words, `agentset.sched.count.${k}`, { n: status.today[k] })}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
