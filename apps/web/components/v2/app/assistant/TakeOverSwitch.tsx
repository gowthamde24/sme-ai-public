"use client";

import * as React from "react";

import type { TakeOver as State, TakeOverError } from "@/lib/take-over/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

type Out = { ok: true; data: State } | { ok: false; error: TakeOverError };

/**
 * Settings > AI assistant > "Listening in and taking over" (job 1, C1's `GET/PUT /calls/take-over-setting`): ONE switch, OFF until the Owner turns it on. In plain words: what it lets an Owner or Admin do during a live call,
 * what the caller hears, that nothing is recorded, that every change and every session is written to the audit log with who and when, and that the assistant can never change this switch. The state shown is what the API answered.
 */
export function TakeOverSwitch({ words, initial, canEdit, change }: { words?: Words; initial: State; canEdit: boolean; change: (enabled: boolean) => Promise<Out> }) {
  const t = makeT(words);
  const [state, setState] = React.useState(initial);
  const [error, setError] = React.useState<TakeOverError | null>(null);
  const [busy, startChange] = React.useTransition();
  const [done, setDone] = React.useState(false);
  const flip = () =>
    startChange(async () => {
      setError(null);
      setDone(false);
      const r = await change(!state.enabled);
      if (r.ok) {
        setState(r.data);
        setDone(true);
      } else setError(r.error);
    });
  return (
    <section className={`${surface} flex flex-col gap-3`} aria-labelledby="tov-h" data-part="take-over">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="tov-h" className="text-lg font-semibold text-ink">{t("tov.title")}</h2>
        <span data-state={state.enabled ? "on" : "off"} className={`rounded-full px-3 py-1 text-xs font-semibold ${state.enabled ? "bg-green-bg text-green-text" : "bg-surface-2 text-muted"}`}>{t(state.enabled ? "tov.on" : "tov.off")}</span>
      </div>
      <p className="text-sm text-muted">{t("tov.what")}</p>
      <ul className="list-disc pl-5 text-sm text-muted" data-part="take-over-rules">
        <li>{t("tov.rule.norecord")}</li>
        <li>{t("tov.rule.audit")}</li>
        <li>{t("tov.rule.assistant")}</li>
        <li>{t(state.announces ? "tov.rule.announce.on" : "tov.rule.announce.off")}</li>
      </ul>
      <p className={fieldHelp}>{t("tov.default")}</p>
      {canEdit ? (
        <div>
          <button type="button" className={state.enabled ? btnQuiet : btnMain} disabled={busy} onClick={flip}>
            {t(state.enabled ? "tov.turnoff" : "tov.turnon")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("tov.owneronly")}</p>
      )}
      {error ? (
        <p role="alert" className={alertBox}>
          {t(`tov.err.${error}` as "tov.err.down")}
        </p>
      ) : null}
      {done ? <p role="status" className={okBox}>{t(state.enabled ? "tov.done.on" : "tov.done.off")}</p> : null}
    </section>
  );
}
