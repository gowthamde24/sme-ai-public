"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { TripOut } from "@contracts";

import { photoErrorKey } from "../catalogue/photo-errors";
import { preparePhoto } from "../catalogue/prepare-photo";
import { Pill } from "../parts";
import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, quiet, secondary } from "../visits/styles";
import { groupIndianSafe } from "./format";
import { ETA, editable, notifiable, stepsFrom } from "./trip-logic";
import { uploadProof } from "./upload-proof";

const PROBLEMS = ["truck_breakdown", "customer_not_ready", "site_closed", "wrong_material", "road_blocked", "other"] as const;
const NOTIFY = ["left", "soon", "delivered", "delay"] as const;
type Refused = { ok: false; error: string; mfa?: boolean; stale?: boolean };
export type TripCardActions = {
  setStatus: (tripId: string, status: "planned" | "loaded" | "on_the_way" | "problem" | "cancelled", problem?: string) => Promise<{ ok: true } | Refused>;
  notify: (tripId: string, kind: string, eta: string | null, language: string) => Promise<{ ok: true; text: string; status: string } | Refused>;
};
const TONE = { planned: "neutral", loaded: "info", on_the_way: "brand", delivered: "green", problem: "red", cancelled: "neutral" } as const;

/**
 * One trip as a card (job CO): the order, the date, the vehicle and driver, the site, what it carries, its status and the next steps (loaded, on the way, delivered with the proof, a problem with its reason). "Delivered"
 * needs a photo and the name of who received the goods. "Tell the site" sends a fixed message to the site contact through the outbox, with the outbox's own rules (consent, quiet hours); a delay is held for a person. The
 * API decides what is allowed (a truck cannot leave before the order is dispatched); a refusal is shown in our words.
 */
export function TripCard({ trip, base, siteLabel, words, role, actions, uploadUrl, compact = false }: { trip: TripOut; base: string; siteLabel: string | null; words: TodayWords; role: "owner" | "admin" | "sales" | "viewer"; actions: TripCardActions; uploadUrl: string; compact?: boolean }) {
  const router = useRouter();
  const [sheet, setSheet] = React.useState<null | "problem" | "delivered" | "notify">(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<(typeof PROBLEMS)[number]>("truck_breakdown");
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [photoId] = React.useState(() => crypto.randomUUID());
  const [kind, setKind] = React.useState<(typeof NOTIFY)[number]>("left");
  const [eta, setEta] = React.useState("");
  const writer = role !== "viewer";
  const here = `${base}/orders/trips/${trip.id}`;
  const close = () => { if (!busy) { setSheet(null); setProblem(null); } };

  async function step(status: "planned" | "loaded" | "on_the_way" | "problem" | "cancelled", reason?: string) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const out = await actions.setStatus(trip.id, status, reason);
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setSheet(null);
    router.refresh();
  }
  async function deliver() {
    if (busy) return;
    setProblem(null);
    if (name.trim() === "") return setProblem({ text: say(words, "trip.err.receiver") });
    if (!file) return setProblem({ text: say(words, "trip.err.photo") });
    setBusy(true);
    const prepared = await preparePhoto(file);
    if (!prepared.ok) {
      setBusy(false);
      return setProblem({ text: say(words, photoErrorKey(prepared.code)) });
    }
    const out = await uploadProof(uploadUrl, name.trim(), photoId, prepared.blob, prepared.blob.type || file.type);
    if (out.ok) {
      setSheet(null);
      router.refresh();
    } else setProblem({ text: say(words, out.code === "trip_state" ? "trip.err.state" : out.code === "proof_incomplete" ? "trip.err.proof" : out.code === "mfa_required" ? "today.err.mfa" : photoErrorKey(out.code)) });
    setBusy(false);
  }
  async function tell() {
    if (busy) return;
    setProblem(null);
    if (eta.trim() !== "" && !ETA.test(eta.trim())) return setProblem({ text: say(words, "trip.err.eta") });
    setBusy(true);
    const out = await actions.notify(trip.id, kind, eta.trim() || null, "en");
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setNote(say(words, `trip.notify.${out.status === "sent" ? "sent" : out.status === "queued" ? "queued" : out.status === "needs_approval" ? "held" : "blocked"}`));
    setSheet(null);
  }

  const steps = writer ? stepsFrom(trip.status) : [];
  const stepLabel = (s: string) => say(words, `trip.step.${s}`);
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4" data-trip={trip.id} data-status={trip.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-lg font-semibold">
          <Link href={here} className="hover:underline">{say(words, "trip.title", { order: trip.order_no, n: trip.trip_no })}</Link>
        </p>
        <Pill tone={TONE[trip.status]}>{say(words, `trip.status.${trip.status}`)}</Pill>
      </div>
      <p className="text-base [overflow-wrap:anywhere]">{trip.lines.map((l) => `${groupIndianSafe(l.quantity)} ${l.unit} · ${l.name}`).join("; ")}</p>
      {compact ? null : (
        <p className="text-sm text-muted [overflow-wrap:anywhere]">
          {[trip.planned_date, trip.vehicle_no, trip.driver_name, siteLabel].filter(Boolean).join(" · ")}
        </p>
      )}
      {trip.problem_code ? <p role="note" className="text-sm font-medium text-red-text">{say(words, `trip.problem.${trip.problem_code}`)}</p> : null}
      {trip.proof ? <p className="text-sm text-green-text">{say(words, "trip.proof.by", { name: trip.proof.received_by })}</p> : null}
      {note ? <p role="status" className={okLine}>{note}</p> : null}
      {problem && sheet === null ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => (
          <button key={s} type="button" disabled={busy} className={s === "loaded" || s === "on_the_way" || s === "delivered" ? primary : secondary} onClick={() => (s === "delivered" ? setSheet("delivered") : s === "problem" ? setSheet("problem") : void step(s))}>
            {stepLabel(s)}
          </button>
        ))}
        {writer && notifiable(trip.status) ? (
          <button type="button" className={secondary} disabled={busy} onClick={() => setSheet("notify")}>{say(words, "trip.tell")}</button>
        ) : null}
        {writer && editable(trip.status) ? <Link href={`${here}?edit=1`} className={quiet}>{say(words, "trip.edit")}</Link> : null}
        <Link href={`${here}/challan`} className={quiet}>{say(words, "trip.challan")}</Link>
      </div>

      <Sheet open={sheet === "problem"} onClose={close} busy={busy} id={`problem-${trip.id}`} title={say(words, "trip.s.problem.title")} closeLabel={say(words, "today.act.cancel")}>
        <div>
          <label htmlFor={`pc-${trip.id}`} className={label}>{say(words, "trip.s.problem.why")}</label>
          <select id={`pc-${trip.id}`} data-autofocus value={code} disabled={busy} onChange={(e) => setCode(e.target.value as (typeof PROBLEMS)[number])} className={field}>
            {PROBLEMS.map((c) => (<option key={c} value={c}>{say(words, `trip.problem.${c}`)}</option>))}
          </select>
          <p className={help}>{say(words, "trip.s.problem.help")}</p>
        </div>
        {problem ? <p role="alert" className={errorLine}>{problem.text}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void step("problem", code)}>{busy ? say(words, "today.act.working") : say(words, "trip.s.problem.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={close}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>

      <Sheet open={sheet === "delivered"} onClose={close} busy={busy} id={`delivered-${trip.id}`} title={say(words, "trip.s.delivered.title", { order: trip.order_no, n: trip.trip_no })} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "trip.s.delivered.body")}</p>
        <div>
          <label htmlFor={`rb-${trip.id}`} className={label}>{say(words, "trip.s.delivered.name")}</label>
          <input id={`rb-${trip.id}`} data-autofocus value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor={`ph-${trip.id}`} className={label}>{say(words, "trip.s.delivered.photo")}</label>
          <input id={`ph-${trip.id}`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block min-h-12 w-full text-base" />
          <p className={help}>{say(words, "trip.s.delivered.photo.help")}</p>
        </div>
        {problem ? <p role="alert" className={errorLine}>{problem.text}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void deliver()}>{busy ? say(words, "today.act.working") : say(words, "trip.s.delivered.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={close}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>

      <Sheet open={sheet === "notify"} onClose={close} busy={busy} id={`notify-${trip.id}`} title={say(words, "trip.s.notify.title")} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "trip.s.notify.body")}</p>
        <div role="radiogroup" aria-label={say(words, "trip.s.notify.title")} className="flex flex-col gap-1">
          {NOTIFY.map((k) => (
            <label key={k} className="flex min-h-11 items-center gap-3 text-base">
              <input type="radio" name={`nk-${trip.id}`} data-autofocus={k === "left" ? true : undefined} className="size-5 shrink-0 accent-brand-text" checked={kind === k} disabled={busy} onChange={() => setKind(k)} />
              {say(words, `trip.notify.kind.${k}`)}
            </label>
          ))}
        </div>
        {kind === "left" ? (
          <div>
            <label htmlFor={`eta-${trip.id}`} className={label}>{say(words, "trip.s.notify.eta")}</label>
            <input id={`eta-${trip.id}`} value={eta} maxLength={8} disabled={busy} onChange={(e) => setEta(e.target.value)} className={`${field} max-w-40`} aria-describedby={`eta-${trip.id}-h`} />
            <p id={`eta-${trip.id}-h`} className={help}>{say(words, "trip.s.notify.eta.help")}</p>
          </div>
        ) : null}
        <p className={help}>{say(words, "trip.s.notify.note")}</p>
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={primary} disabled={busy} onClick={() => void tell()}>{busy ? say(words, "today.act.working") : say(words, "trip.s.notify.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={close}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </li>
  );
}
