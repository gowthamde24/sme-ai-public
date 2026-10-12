import type { ReactNode } from "react";

import { type PolicyVersion } from "@/lib/api/followups";

import { LocalTime } from "../../../local-time";
import { hintInline, kvList, listItemCard, pageH1 } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

/** The policy versions, newest first, in plain words. A version never changes: the Owner publishes a new one. The policy in force is the latest one that has started. */
export function PolicyView({ versions, today, form, words }: { versions: PolicyVersion[]; today: string; form: ReactNode; words?: Words; }) {
  const t = makeT(words);
  const inForce = versions.find((v) => v.effective_from <= today);
  return (
    <section aria-labelledby="policy-heading">
      <h1 id="policy-heading" className={pageH1}>{t("fu.the_follow_up_policy")}</h1>
      {versions.length === 0 ? (
        <p>{t("fu.no_policy_yet_until_the_owner")}</p>
      ) : (
        <ul aria-label={t("fu.policy_versions_newest_first")}>
          {versions.map((v) => (
            <li key={v.id} className={listItemCard}>
              <strong>{t("fu.version_n", { n: v.version_no })}</strong> · {t("fu.starts_line", { date: v.effective_from })}
              {inForce?.id === v.id ? " " + t("fu.in_force_today") : v.effective_from > today ? " " + t("fu.not_started_yet") : " " + t("fu.replaced_by_a_newer_version")}
              <dl className={kvList}>
                <dt>{t("fu.touches_at_most")}</dt>
                <dd>{v.max_touches}</dd>
                <dt>{t("fu.days_to_wait")}</dt>
                <dd>{v.gap_days.length === 0 ? "—" : v.gap_days.join(", ")}</dd>
                <dt>{t("fu.quiet_hours")}</dt>
                <dd>
                  {t("fu.range_to", { start: v.quiet_start, end: v.quiet_end })}
                </dd>
                <dt>{t("fu.weekdays")}</dt>
                <dd>{v.allowed_weekdays.map((d) => t(`fu.weekday.${d}`)).join(", ")}</dd>
                <dt>{t("fu.holidays")}</dt>
                <dd>{v.holidays.length === 0 ? t("fu.none") : v.holidays.join(", ")}</dd>
                <dt>{t("fu.minimum_gap")}</dt>
                <dd>{t("fu.hours_n", { n: v.min_gap_hours })}</dd>
                <dt>{t("fu.utc_offset")}</dt>
                <dd>{t("fu.minutes_n", { n: v.recipient_utc_offset_minutes })}</dd>
              </dl>
              <span className={hintInline}>
                <Rich t={t} k="fu.published_line" with={{ time: <LocalTime iso={v.created_at} /> }} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {form}
    </section>
  );
}
