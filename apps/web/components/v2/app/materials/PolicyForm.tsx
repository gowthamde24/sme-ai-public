"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { PolicyBody } from "@contracts";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet, secondary } from "../visits/styles";
import { MAX_SLABS, formFromPolicy, policyFromForm, type PolicyForm as Form, type SlabText } from "./policy-logic";

type Refused = { ok: false; error: string; mfa?: boolean };
const CHECK = "inline-flex min-h-11 items-center gap-3 text-base";

/**
 * The owner's quote rules (job CO; the Owner saves, with the second factor; Admin and Sales read). Wastage, whole pallets, freight (per trip, or by the kilometre in slabs), loading, laying, GST on each, the advance, the
 * credit days and how long a quote is good for. Saving makes a NEW version that applies from today; older quotes keep the rules they were made with. Every box is the owner's own number: nothing is filled in for
 * them except the engine's usual starting points (5 percent wastage, half in advance, seven days).
 */
export function PolicyForm(p: { base: string; versionId: string; current: PolicyBody | null; words: TodayWords; save: (versionId: string, policy: PolicyBody) => Promise<{ ok: true } | Refused>; go?: (href: string) => void }) {
  const { words } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const [f, setF] = React.useState<Form>(() => formFromPolicy(p.current));
  const [busy, setBusy] = React.useState(false);
  const [bad, setBad] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((c) => ({ ...c, [k]: v })); setBad(null); };
  const text = (k: Exclude<keyof Form, "roundPallet" | "billWastage" | "laying" | "transport" | "basis" | "handling" | "slabs">, id: string, labelKey: string, helpKey?: string, mode: "decimal" | "numeric" = "decimal") => (
    <div>
      <label htmlFor={id} className={label}>{say(words, labelKey)}</label>
      <input id={id} inputMode={mode} value={f[k]} disabled={busy} aria-invalid={bad === k} aria-describedby={helpKey ? `${id}-h` : undefined} onChange={(e) => set(k, e.target.value as never)} className={`${field} max-w-60 ${bad === k ? "border-red-text" : ""}`} />
      {helpKey ? <p id={`${id}-h`} className={help}>{say(words, helpKey)}</p> : null}
    </div>
  );
  const slab = (i: number, patch: Partial<SlabText>) => set("slabs", f.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    if (busy) return;
    setProblem(null);
    const r = policyFromForm(f);
    if (!r.ok) {
      setBad(r.field);
      return setProblem({ text: say(words, "mat.pol.err.field", { field: say(words, `mat.pol.f.${r.field}`) }) });
    }
    setBusy(true);
    const out = await p.save(p.versionId, r.policy);
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    go(`${p.base}/quote-policy?saved=1`);
  }
  return (
    <form data-screen="material-policy" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-2xl flex-col gap-5">
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "mat.pol.qty")}</legend>
        {text("wastage", "pol-wastage", "mat.pol.wastage", "mat.pol.wastage.help")}
        <label className={CHECK}><input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={f.roundPallet} disabled={busy} onChange={(e) => set("roundPallet", e.target.checked)} />{say(words, "mat.pol.pallet")}</label>
        <label className={CHECK}><input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={f.billWastage} disabled={busy} onChange={(e) => set("billWastage", e.target.checked)} />{say(words, "mat.pol.billwaste")}</label>
        <p className={help}>{say(words, "mat.pol.billwaste.help")}</p>
      </fieldset>
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "mat.pol.transport")}</legend>
        <div role="radiogroup" aria-label={say(words, "mat.pol.transport")} className="flex flex-col gap-1">
          {(["none", "per_trip", "per_km_slab"] as const).map((k) => (
            <label key={k} className={CHECK}><input type="radio" name="pol-transport" className="size-5 shrink-0 accent-brand-text" checked={f.transport === k} disabled={busy} onChange={() => set("transport", k)} />{say(words, `mat.pol.t.${k}`)}</label>
          ))}
        </div>
        {f.transport !== "none" ? (
          <>
            <div>
              <label htmlFor="pol-basis" className={label}>{say(words, "mat.pol.basis")}</label>
              <select id="pol-basis" value={f.basis} disabled={busy} onChange={(e) => set("basis", e.target.value as Form["basis"])} className={`${field} max-w-60`}>
                <option value="pieces">{say(words, "mat.pol.basis.pieces")}</option>
                <option value="area">{say(words, "mat.pol.basis.area")}</option>
              </select>
            </div>
            {text("capacity", "pol-cap", "mat.pol.capacity", "mat.pol.capacity.help", "numeric")}
            {f.transport === "per_trip" ? text("ratePerTrip", "pol-rate", "mat.pol.rate") : (
              <div className="flex flex-col gap-2" data-part="slabs">
                <p className="text-sm font-semibold">{say(words, "mat.pol.slabs")}</p>
                {f.slabs.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <div>
                      <label htmlFor={`pol-km-${i}`} className={label}>{say(words, "mat.pol.slab.km")}</label>
                      <input id={`pol-km-${i}`} inputMode="numeric" value={s.km} disabled={busy} aria-invalid={bad === "slabs"} onChange={(e) => slab(i, { km: e.target.value })} className={field} />
                    </div>
                    <div>
                      <label htmlFor={`pol-ch-${i}`} className={label}>{say(words, "mat.pol.slab.charge")}</label>
                      <input id={`pol-ch-${i}`} inputMode="decimal" value={s.charge} disabled={busy} aria-invalid={bad === "slabs"} onChange={(e) => slab(i, { charge: e.target.value })} className={field} />
                    </div>
                    <button type="button" className={quiet} disabled={busy || f.slabs.length <= 1} aria-label={say(words, "mat.pol.slab.remove", { n: i + 1 })} onClick={() => set("slabs", f.slabs.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <div><button type="button" className={secondary} disabled={busy || f.slabs.length >= MAX_SLABS} onClick={() => set("slabs", [...f.slabs, { km: "", charge: "" }])}>{say(words, "mat.pol.slab.add")}</button></div>
              </div>
            )}
            {text("freeAbove", "pol-free", "mat.pol.free", "mat.pol.free.help")}
            {text("transportGst", "pol-tgst", "mat.pol.gst")}
          </>
        ) : null}
      </fieldset>
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "mat.pol.handling")}</legend>
        <div role="radiogroup" aria-label={say(words, "mat.pol.handling")} className="flex flex-col gap-1">
          {(["none", "order", "trip"] as const).map((k) => (
            <label key={k} className={CHECK}><input type="radio" name="pol-handling" className="size-5 shrink-0 accent-brand-text" checked={f.handling === k} disabled={busy} onChange={() => set("handling", k)} />{say(words, `mat.pol.h.${k}`)}</label>
          ))}
        </div>
        {f.handling !== "none" ? (<>{text("handlingAmount", "pol-hamt", "mat.pol.hamount")}{text("handlingGst", "pol-hgst", "mat.pol.gst")}</>) : null}
      </fieldset>
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "mat.pol.laying")}</legend>
        <label className={CHECK}><input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={f.laying} disabled={busy} onChange={(e) => set("laying", e.target.checked)} />{say(words, "mat.pol.laying.on")}</label>
        {f.laying ? (<>{text("layingRate", "pol-lrate", "mat.pol.lrate", "mat.pol.lrate.help")}{text("layingGst", "pol-lgst", "mat.pol.gst")}</>) : null}
      </fieldset>
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "mat.pol.terms")}</legend>
        {text("advance", "pol-adv", "mat.pol.advance", "mat.pol.advance.help")}
        {text("creditDays", "pol-credit", "mat.pol.credit", "mat.pol.credit.help", "numeric")}
        {text("validityDays", "pol-valid", "mat.pol.valid", undefined, "numeric")}
      </fieldset>
      <p className={help}>{say(words, "mat.pol.note")}</p>
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
        <button type="submit" disabled={busy} className={primary}>{busy ? say(words, "today.act.working") : say(words, "mat.pol.save")}</button>
        <Link href={`${p.base}/quote-policy`} aria-disabled={busy} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
      
    </form>
  );
}
