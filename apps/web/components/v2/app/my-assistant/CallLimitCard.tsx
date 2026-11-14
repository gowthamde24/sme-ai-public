"use client";

import * as React from "react";

import { CALL_LIMIT_MAX, CALL_LIMIT_MIN, type CallLimit } from "@/lib/api/call-limit";

import { btnMain, btnQuiet, fieldInput, fieldLabel, mutedText, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Calls per day" (My assistant > Rules; owner, 14 Nov 2026): the business's own limit on the calls its assistant makes in a day (India time), default 100. The Owner changes it after one in-app question ("Change the limit to 150 calls a day?"); others see the number. Plain words, the numbers as the API counted them.
 */
export type CallLimitActions = { save: (limit: number) => Promise<{ ok: true; data: CallLimit } | { ok: false; error: "range" | "forbidden" | "down" }> };

export function CallLimitCard({ words, initial, canEdit, mock, actions }: { words?: Words; initial: CallLimit; canEdit: boolean; mock: boolean; actions: CallLimitActions }) {
  const t = makeT(words);
  const [cur, setCur] = React.useState(initial);
  const [text, setText] = React.useState(String(initial.limit));
  const [asking, setAsking] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ kind: "saved"; n: number } | { kind: "error"; error: "range" | "forbidden" | "down" } | null>(null);
  const n = Number(text.trim());
  const valid = text.trim() !== "" && Number.isInteger(n) && n >= CALL_LIMIT_MIN && n <= CALL_LIMIT_MAX;
  const save = async (limit: number) => {
    setBusy(true);
    setNote(null);
    let out: Awaited<ReturnType<CallLimitActions["save"]>>;
    try {
      out = await actions.save(limit);
    } catch {
      out = { ok: false, error: "down" };
    }
    setBusy(false);
    setAsking(null);
    if (out.ok) {
      setCur(out.data);
      setText(String(out.data.limit));
      setNote({ kind: "saved", n: out.data.limit });
    } else setNote({ kind: "error", error: out.error });
  };
  return (
    <section data-part="call-limit" aria-labelledby="cl-title" className={`${surface} flex flex-col gap-2`}>
      <h3 id="cl-title" className="m-0 font-display text-lg font-bold">
        {t("cl.title")}
      </h3>
      <p className="m-0 text-base text-muted">{t("cl.help", { default: cur.defaultLimit })}</p>
      <p data-part="call-limit-used" className="m-0 text-base font-semibold">
        {t("cl.used", { used: cur.used, remaining: cur.remaining })}
      </p>
      {canEdit ? (
        asking !== null ? (
          <div role="group" aria-label={t("cl.ask", { n: asking })} className="flex flex-col gap-2">
            <p className="m-0 text-base font-semibold">{t("cl.ask", { n: asking })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void save(asking)} className={`${btnMain} min-h-11`}>
                {t("cl.yes")}
              </button>
              <button type="button" disabled={busy} onClick={() => setAsking(null)} className={`${btnQuiet} min-h-11`}>
                {t("dst.af.back")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="cl-input" className={fieldLabel}>
                {t("cl.label")}
              </label>
              <input id="cl-input" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} className={`${fieldInput} w-40`} />
            </div>
            <button type="button" disabled={busy || !valid || n === cur.limit} onClick={() => setAsking(n)} className={`${btnMain} min-h-11`}>
              {t("cl.save")}
            </button>
          </div>
        )
      ) : null}
      {canEdit && text.trim() !== "" && !valid ? (
        <p role="alert" className="m-0 text-sm text-red-text">
          {t("cl.err.range")}
        </p>
      ) : null}
      {note?.kind === "saved" ? (
        <p role="status" data-part="call-limit-saved" className="m-0 text-sm font-semibold text-green-text">
          {t("cl.saved", { n: note.n })}
        </p>
      ) : note?.kind === "error" ? (
        <p role="alert" className="m-0 text-sm text-red-text">
          {t(`cl.err.${note.error}`)}
        </p>
      ) : null}
      {mock ? <p className={`${mutedText} !mt-0`}>{t("cl.mock")}</p> : null}
    </section>
  );
}
