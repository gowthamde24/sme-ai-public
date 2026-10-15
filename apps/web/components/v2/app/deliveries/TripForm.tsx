"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet } from "../visits/styles";
import { groupIndianSafe } from "./format";
import { PHONE, VEHICLE, type LineRoom } from "./trip-logic";

export type TripFormValues = { plannedDate: string; vehicleNo: string; driverName: string; driverPhone: string; siteId: string; quantities: Record<number, string> };
type Refused = { ok: false; error: string; mfa?: boolean };
export type TripFormActions = { save: (input: { plannedDate: string; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; siteId: string | null; lines: { line_no: number; quantity: number }[] }) => Promise<{ ok: true; date: string } | Refused> };

/**
 * Plan a trip, or change a planned one (job CO; Owner, Admin and Sales). The date, the vehicle, the driver and the site; for each line of the order how many go on this truck (the room left is shown, and the first
 * truck is filled up to what a truck carries). A line that is left empty does not travel on this trip. The API checks again that a line never goes out more than the order holds.
 */
export function TripForm(p: { base: string; rooms: readonly LineRoom[]; sites: readonly { id: string; label: string }[]; initial: TripFormValues; today: string; words: TodayWords; actions: TripFormActions; backHref: string; editing: boolean; go?: (href: string) => void }) {
  const { words } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const [v, setV] = React.useState<TripFormValues>(p.initial);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const set = <K extends keyof TripFormValues>(k: K, x: TripFormValues[K]) => setV((c) => ({ ...c, [k]: x }));

  async function save() {
    if (busy) return;
    setProblem(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.plannedDate)) return setProblem({ text: say(words, "trip.err.date") });
    const vehicle = v.vehicleNo.trim();
    const phone = v.driverPhone.trim();
    if (vehicle !== "" && !VEHICLE.test(vehicle)) return setProblem({ text: say(words, "trip.err.vehicle") });
    if (phone !== "" && !PHONE.test(phone)) return setProblem({ text: say(words, "trip.err.phone") });
    const lines: { line_no: number; quantity: number }[] = [];
    for (const r of p.rooms) {
      const raw = (v.quantities[r.lineNo] ?? "").trim();
      if (raw === "") continue;
      const q = Number(raw.replace(/,/g, ""));
      if (!Number.isInteger(q) || q < 1 || q > 10_000_000) return setProblem({ text: say(words, "trip.err.qty", { name: r.name }) });
      lines.push({ line_no: r.lineNo, quantity: q });
    }
    if (lines.length === 0) return setProblem({ text: say(words, "trip.err.nolines") });
    setBusy(true);
    const out = await p.actions.save({ plannedDate: v.plannedDate, vehicleNo: vehicle || null, driverName: v.driverName.trim() || null, driverPhone: phone || null, siteId: v.siteId || null, lines });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    go(`${p.base}/orders/trips?date=${out.date}&saved=1`);
  }
  return (
    <form data-screen="trip-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-2xl flex-col gap-5">
      <div>
        <label htmlFor="trip-date" className={label}>{say(words, "trip.field.date")}</label>
        <input id="trip-date" type="date" min={p.editing ? undefined : p.today} value={v.plannedDate} disabled={busy} onChange={(e) => set("plannedDate", e.target.value)} className={`${field} max-w-60`} />
      </div>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "trip.field.load")}</legend>
        {p.rooms.map((r) => (
          <div key={r.lineNo}>
            <label htmlFor={`trip-q-${r.lineNo}`} className={label}>{r.name} ({r.unit})</label>
            <input id={`trip-q-${r.lineNo}`} inputMode="numeric" value={v.quantities[r.lineNo] ?? ""} disabled={busy} aria-describedby={`trip-q-${r.lineNo}-h`} onChange={(e) => set("quantities", { ...v.quantities, [r.lineNo]: e.target.value })} className={`${field} max-w-60`} />
            <p id={`trip-q-${r.lineNo}-h`} className={help}>{say(words, "trip.field.room", { ordered: groupIndianSafe(r.ordered), planned: groupIndianSafe(r.planned), left: groupIndianSafe(r.remaining) })}</p>
          </div>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="trip-vehicle" className={label}>{say(words, "trip.field.vehicle")}</label>
          <input id="trip-vehicle" value={v.vehicleNo} maxLength={20} disabled={busy} onChange={(e) => set("vehicleNo", e.target.value)} aria-describedby="trip-vehicle-h" className={field} />
          <p id="trip-vehicle-h" className={help}>{say(words, "trip.field.vehicle.help")}</p>
        </div>
        <div>
          <label htmlFor="trip-driver" className={label}>{say(words, "trip.field.driver")}</label>
          <input id="trip-driver" value={v.driverName} maxLength={80} disabled={busy} onChange={(e) => set("driverName", e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="trip-phone" className={label}>{say(words, "trip.field.phone")}</label>
          <input id="trip-phone" inputMode="tel" value={v.driverPhone} maxLength={20} disabled={busy} onChange={(e) => set("driverPhone", e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="trip-site" className={label}>{say(words, "trip.field.site")}</label>
          <select id="trip-site" value={v.siteId} disabled={busy} onChange={(e) => set("siteId", e.target.value)} className={field}>
            <option value="">{say(words, "trip.field.site.order")}</option>
            {p.sites.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
          </select>
        </div>
      </div>
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
        <button type="submit" disabled={busy} className={primary}>{busy ? say(words, "today.act.working") : say(words, p.editing ? "trip.save.edit" : "trip.save.new")}</button>
        <Link href={p.backHref} aria-disabled={busy} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
    </form>
  );
}
