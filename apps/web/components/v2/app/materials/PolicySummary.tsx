import type { PolicyOut } from "@contracts";

import { formatRupees, groupIndian, percentFromBps } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";
import { card } from "../visits/styles";

/** The rules in force, in plain words (job CO): what a quote will do today. Shown to Owner, Admin and Sales; only the Owner changes them. */
export function PolicySummary({ policy, words }: { policy: PolicyOut; words: TodayWords }) {
  const cur = policy.current;
  if (!cur)
    return (
      <div className={card} data-state="none">
        <p className="text-base font-semibold">{say(words, "mat.pol.none")}</p>
        <p className="text-sm text-muted">{say(words, "mat.pol.none.help")}</p>
      </div>
    );
  const p = cur.policy;
  const t = p.transport;
  const rows: [string, string][] = [
    [say(words, "mat.pol.wastage"), `${percentFromBps(p.default_wastage_bps ?? 500)}%`],
    [say(words, "mat.pol.pallet"), say(words, p.round_to_pallet ? "fields.form.yes" : "fields.form.no")],
    [say(words, "mat.pol.transport"), !t || t.kind === "none" ? say(words, "mat.pol.t.none") : t.kind === "per_trip" ? say(words, "mat.pol.sum.trip", { rate: formatRupees(t.rate_per_trip_paise ?? 0), cap: groupIndian(t.truck_capacity ?? 0), basis: say(words, `mat.pol.basis.${t.capacity_basis ?? "pieces"}`) }) : say(words, "mat.pol.sum.slab", { n: t.slabs?.length ?? 0, cap: groupIndian(t.truck_capacity ?? 0), basis: say(words, `mat.pol.basis.${t.capacity_basis ?? "pieces"}`) })],
    [say(words, "mat.pol.handling"), p.handling ? say(words, "mat.pol.sum.handling", { amount: formatRupees(p.handling.amount_paise), per: say(words, `mat.pol.per.${p.handling.per}`) }) : say(words, "mat.pol.h.none")],
    [say(words, "mat.pol.laying"), p.laying ? say(words, "mat.pol.sum.laying", { rate: formatRupees(p.laying.rate_paise_per_area) }) : say(words, "mat.pol.laying.off")],
    [say(words, "mat.pol.advance"), `${percentFromBps(p.advance_bps ?? 5000)}%`],
    [say(words, "mat.pol.credit"), say(words, "mat.in.days", { n: p.credit_days ?? 0 })],
    [say(words, "mat.pol.valid"), say(words, "mat.in.days", { n: p.validity_days ?? 7 })],
  ];
  return (
    <section className={card} aria-labelledby="mat-pol-now" data-state="current">
      <h2 id="mat-pol-now" className="font-display text-xl font-bold">{say(words, "mat.pol.now", { n: cur.version_no, date: cur.effective_from })}</h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-base [&>dt]:text-sm [&>dt]:font-semibold [&>dt]:text-muted">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt>{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>))}
      </dl>
      {policy.versions.length > 1 ? <p className="text-sm text-muted">{say(words, "mat.pol.versions", { n: policy.versions.length })}</p> : null}
    </section>
  );
}
