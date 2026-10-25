"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import * as React from "react";

import type { TripOut } from "@contracts";

import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, okLine, primary, quiet, secondary } from "../visits/styles";
import { groupIndianSafe } from "./format";
import { editable, notifiable, stepsFrom } from "./trip-logic";

/** The sheets are a chunk of their own (job DO): a trip screen loads them when the first one is opened, not with the page. */
const TripSheets = dynamic(() => import("./TripSheets"), { ssr: false });
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
  const writer = role !== "viewer";
  const here = `${base}/orders/trips/${trip.id}`;
  const [sheetSeen, setSheetSeen] = React.useState(false); // once a sheet has been opened its chunk stays drawn (it animates shut)
  const openSheet = (which: "problem" | "delivered" | "notify") => { setSheetSeen(true); setSheet(which); };

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
          <button key={s} type="button" disabled={busy} className={s === "loaded" || s === "on_the_way" || s === "delivered" ? primary : secondary} onClick={() => (s === "delivered" ? openSheet("delivered") : s === "problem" ? openSheet("problem") : void step(s))}>
            {stepLabel(s)}
          </button>
        ))}
        {writer && notifiable(trip.status) ? (
          <button type="button" className={secondary} disabled={busy} onClick={() => openSheet("notify")}>{say(words, "trip.tell")}</button>
        ) : null}
        {writer && editable(trip.status) ? <Link href={`${here}?edit=1`} className={quiet}>{say(words, "trip.edit")}</Link> : null}
        <Link href={`${here}/challan`} className={quiet}>{say(words, "trip.challan")}</Link>
      </div>

      {sheetSeen ? (
        <TripSheets
          trip={trip}
          words={words}
          uploadUrl={uploadUrl}
          actions={actions}
          sheet={sheet}
          onClose={() => setSheet(null)}
          onChanged={() => router.refresh()}
          onNote={setNote}
        />
      ) : null}
    </li>
  );
}
