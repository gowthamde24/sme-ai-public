import type { ReactNode } from "react";

import { WEEKDAY_LABELS, type PolicyVersion } from "@/lib/api/followups";

import { LocalTime } from "../../../local-time";

/** The policy versions, newest first, in plain words. A version never changes: the Owner publishes a new one. The policy in force is the latest one that has started. */
export function PolicyView({ versions, today, form }: { versions: PolicyVersion[]; today: string; form: ReactNode }) {
  const inForce = versions.find((v) => v.effective_from <= today);
  return (
    <section aria-labelledby="policy-heading">
      <h1 id="policy-heading">The follow-up policy</h1>
      {versions.length === 0 ? (
        <p>No policy yet. Until the owner publishes one, no follow-up draft can be made.</p>
      ) : (
        <ul aria-label="Policy versions, newest first">
          {versions.map((v) => (
            <li key={v.id} className="card">
              <strong>Version {v.version_no}</strong> · starts {v.effective_from}
              {inForce?.id === v.id ? " · in force today" : v.effective_from > today ? " · not started yet" : " · replaced by a newer version"}
              <dl className="summary">
                <dt>Touches at most</dt>
                <dd>{v.max_touches}</dd>
                <dt>Days to wait</dt>
                <dd>{v.gap_days.length === 0 ? "—" : v.gap_days.join(", ")}</dd>
                <dt>Quiet hours</dt>
                <dd>
                  {v.quiet_start} to {v.quiet_end}
                </dd>
                <dt>Weekdays</dt>
                <dd>{v.allowed_weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")}</dd>
                <dt>Holidays</dt>
                <dd>{v.holidays.length === 0 ? "None" : v.holidays.join(", ")}</dd>
                <dt>Minimum gap</dt>
                <dd>{v.min_gap_hours} hours</dd>
                <dt>UTC offset</dt>
                <dd>{v.recipient_utc_offset_minutes} minutes</dd>
              </dl>
              <span className="hint">
                Published <LocalTime iso={v.created_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {form}
    </section>
  );
}
