"use client";

import * as React from "react";

import { ERROR_WORDS, type Card, type Connection, type Deliveries, type Fail } from "@/lib/api/crm-push";

import { copyToClipboard } from "../lead-desk/CopyBox";
import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import type { ConnectorActions, Ok } from "./actions";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const OTHER = "__other";

/** The state line of a card: a dot and one sentence, never an alarm. */
export function stateOf(card: Card): "connected" | "not" | "setup" | "failing" | "paused" {
  if (card.state === "needs_setup") return "setup";
  if (!card.connection) return "not";
  if (card.connection.failing) return "failing";
  return card.connection.active ? "connected" : "paused";
}

/**
 * One connector: a boxed card (it is a thing you connect) with its state, and when opened the steps to do in the other tool, the plain connect form (a labelled field for each key and setting), then, once connected, when to send, the field table,
 * Test connection, Pause, the delivery log and Disconnect. A key lives in this component's state only while it is being typed: it is cleared the moment it is sent, and no answer ever carries one.
 */
export function ConnectorCard({ card, words, events, actions, readOnly, open, onToggle }: { card: Card; words: Words; events: readonly string[]; actions: ConnectorActions; readOnly: boolean; open: boolean; onToggle: () => void }) {
  const t = makeT(words);
  const [conn, setConn] = React.useState<Connection | null>(card.connection);
  // the page's list is replaced when the server sends a new one (a refresh after a save)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setConn(card.connection), [card.connection]);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const live: Card = { ...card, connection: conn, state: card.state === "needs_setup" ? "needs_setup" : conn ? "connected" : "not_connected" };
  const st = stateOf(live);
  const say = (f: Fail): string => t(`crm.fail.${f.error}` as "crm.fail.other");
  const run = async <T,>(go: () => Promise<Ok<T>>, done: (r: { ok: true } & T) => void) => {
    setBusy(true);
    setProblem(null);
    setNote(null);
    const r = await go();
    setBusy(false);
    if (r.ok) done(r);
    else setProblem(say(r));
  };
  const dot = st === "failing" || st === "paused" ? "bg-brand" : st === "connected" ? "bg-green-text" : "bg-muted";
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-part="connector" data-type={card.type}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 lang="en" className="m-0 text-[17px] font-semibold text-ink">
            {card.label}
          </h2>
          <p className="m-0 mt-1 flex items-center gap-2 text-[14px] text-muted" data-part="connector-state">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
            {t(`crm.state.${st}` as "crm.state.not")}
          </p>
        </div>
        <button type="button" className={btnQuiet} aria-expanded={open} onClick={onToggle}>
          {open ? t("crm.close") : t("crm.open")}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-4 border-t border-line pt-4" data-part="connector-panel">
          {problem ? (
            <p role="alert" className="m-0 text-[15px] font-semibold text-ink">
              {problem}
            </p>
          ) : null}
          {note ? (
            <p role="status" className="m-0 text-[15px] text-muted">
              {note}
            </p>
          ) : null}
          {card.state === "needs_setup" ? (
            <p role="note" className="m-0 flex items-start gap-2 text-[15px] text-ink">
              <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-muted" />
              <span lang="en">{card.needsSetup}</span>
            </p>
          ) : (
            <>
              {conn?.failing ? (
                <p role="status" className="m-0 flex items-start gap-2 text-[15px] font-semibold text-ink">
                  <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-brand" />
                  <span>{t("crm.failing", { tool: card.label })}</span>
                </p>
              ) : null}
              {conn && !conn.active ? <p className="m-0 text-[15px] text-muted">{t("crm.paused")}</p> : null}
              {card.setupSteps.length > 0 && !conn ? (
                <div lang="en">
                  <h3 className="m-0 text-[15px] font-semibold text-ink">{t("crm.before")}</h3>
                  <ol className="m-0 mt-1 list-decimal pl-5 text-[15px] text-muted">
                    {card.setupSteps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {card.script ? <ScriptBox script={card.script} words={words} /> : null}
              <ConnectForm card={card} conn={conn} words={words} busy={busy || readOnly} onSave={(v) => void run(() => actions.connect(card.type, v), (r) => { setConn(r.connection); setNote(t("crm.saved")); })} />
              {conn ? (
                <>
                  <EventsForm words={words} events={events} conn={conn} busy={busy || readOnly} onSave={(ev) => void run(() => actions.change(card.type, { events: ev }), (r) => { setConn(r.connection); setNote(t("crm.saved")); })} />
                  <MappingTable card={card} conn={conn} words={words} busy={busy || readOnly} onSave={(m) => void run(() => actions.change(card.type, { mapping: m }), (r) => { setConn(r.connection); setNote(t("crm.saved")); })} />
                  <Actions card={card} conn={conn} words={words} busy={busy || readOnly} actions={actions} run={run} setConn={setConn} setNote={setNote} />
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ScriptBox({ script, words }: { script: string; words: Words }) {
  const t = makeT(words);
  const [copied, setCopied] = React.useState(false);
  return (
    <div data-part="connector-script">
      <label htmlFor="crm-script" className={fieldLabel}>
        {t("crm.script.title")}
      </label>
      <textarea id="crm-script" readOnly lang="en" spellCheck={false} rows={8} value={script} className="min-h-12 w-full rounded-lg border border-edge bg-surface px-3 py-2 font-mono text-[13px] text-ink" />
      <button type="button" className={`${btnQuiet} mt-2`} onClick={async () => setCopied(await copyToClipboard(script))}>
        {copied ? t("crm.script.copied") : t("crm.script.copy")}
      </button>
    </div>
  );
}

function ConnectForm({ card, conn, words, busy, onSave }: { card: Card; conn: Connection | null; words: Words; busy: boolean; onSave: (v: { credentials: Record<string, string>; settings: Record<string, string>; mapping?: Record<string, string> }) => void }) {
  const t = makeT(words);
  const [creds, setCreds] = React.useState<Record<string, string>>({});
  const [sets, setSets] = React.useState<Record<string, string>>(conn?.config ?? {});
  const valid = card.credentials.every((c) => (creds[c.key] ?? "").trim().length > 0) && card.settings.every((s) => (sets[s.key] ?? "").trim().length > 0);
  return (
    <form
      className="flex flex-col gap-3"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({ credentials: creds, settings: sets, ...(conn ? { mapping: conn.mapping } : {}) });
        setCreds({});   // a key is never kept after it is sent
      }}
    >
      {conn ? <p className="m-0 text-[14px] text-muted">{t("crm.keys.saved")}</p> : <p className="m-0 text-[14px] text-muted">{t("crm.keys.note")}</p>}
      {card.settings.map((s) => (
        <div key={s.key} className="flex flex-col">
          <label htmlFor={`${card.type}-${s.key}`} lang="en" className={fieldLabel}>
            {s.label}
          </label>
          <input id={`${card.type}-${s.key}`} lang="en" autoComplete="off" spellCheck={false} maxLength={200} placeholder={s.example} value={sets[s.key] ?? ""} onChange={(e) => setSets((c) => ({ ...c, [s.key]: e.target.value }))} className={fieldInput} />
          {s.help ? (
            <span lang="en" className="mt-1 text-[14px] text-muted">
              {s.help}
            </span>
          ) : null}
        </div>
      ))}
      {card.credentials.map((c) => (
        <div key={c.key} className="flex flex-col">
          <label htmlFor={`${card.type}-${c.key}`} lang="en" className={fieldLabel}>
            {c.label}
          </label>
          <input id={`${card.type}-${c.key}`} type="password" lang="en" autoComplete="off" spellCheck={false} maxLength={600} placeholder={conn ? "••••••••" : c.example} value={creds[c.key] ?? ""} onChange={(e) => setCreds((v) => ({ ...v, [c.key]: e.target.value }))} className={fieldInput} />
          {c.help ? (
            <span lang="en" className="mt-1 text-[14px] text-muted">
              {c.help}
            </span>
          ) : null}
        </div>
      ))}
      <div>
        <button type="submit" disabled={busy || !valid} className={btnMain}>
          {conn ? t("crm.save.key") : t("crm.save.connect")}
        </button>
      </div>
    </form>
  );
}

function EventsForm({ words, events, conn, busy, onSave }: { words: Words; events: readonly string[]; conn: Connection; busy: boolean; onSave: (events: string[]) => void }) {
  const t = makeT(words);
  const [picked, setPicked] = React.useState<readonly string[]>(conn.events);
  const changed = picked.length > 0 && (picked.length !== conn.events.length || picked.some((e) => !conn.events.includes(e)));
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-part="connector-events">
      <legend className={fieldLabel}>{t("crm.events")}</legend>
      {events.map((e) => (
        <label key={e} className="flex min-h-11 items-center gap-3 py-1 text-[15px] text-ink">
          <input type="checkbox" className="size-5" checked={picked.includes(e)} onChange={(x) => setPicked((c) => (x.target.checked ? [...c, e] : c.filter((v) => v !== e)))} />
          <span>{t(`crm.ev.${e}` as "crm.ev.call.completed")}</span>
        </label>
      ))}
      <div>
        <button type="button" disabled={busy || !changed} className={btnQuiet} onClick={() => onSave([...picked])}>
          {t("crm.save.events")}
        </button>
      </div>
    </fieldset>
  );
}

/** The field table: a row for each of our fields and where it goes in the other tool (a pick from that tool's fields, "Put in the note", "Don't send", or another field's name typed in). */
function MappingTable({ card, conn, words, busy, onSave }: { card: Card; conn: Connection; words: Words; busy: boolean; onSave: (m: Record<string, string>) => void }) {
  const t = makeT(words);
  const [map, setMap] = React.useState<Record<string, string>>(() => ({ ...card.defaultMapping, ...conn.mapping }));
  const known = new Set(card.targets.map((x) => x.field));
  const selectValue = (v: string): string => (v === "" || v === card.noteValue || known.has(v) ? v : OTHER);
  const [typing, setTyping] = React.useState<Record<string, boolean>>({});
  const changed = JSON.stringify(map) !== JSON.stringify({ ...card.defaultMapping, ...conn.mapping });
  return (
    <div data-part="connector-mapping">
      <h3 className="m-0 text-[15px] font-semibold text-ink">{t("crm.map.title")}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[15px]">
          <thead>
            <tr>
              <th scope="col" className="border-b border-line px-2 py-2 text-[14px] font-semibold text-muted">
                {t("crm.map.ours")}
              </th>
              <th scope="col" className="border-b border-line px-2 py-2 text-[14px] font-semibold text-muted">
                {t("crm.map.theirs")}
              </th>
            </tr>
          </thead>
          <tbody>
            {card.ourFields.map((f) => {
              const value = map[f.key] ?? "";
              const other = typing[f.key] === true || selectValue(value) === OTHER;
              const id = `${card.type}-map-${f.key}`;
              return (
                <tr key={f.key}>
                  <th scope="row" className="border-b border-line px-2 py-2 align-top text-[15px] font-normal text-ink">
                    <label htmlFor={id}>{t(`crm.field.${f.key}` as "crm.field.name")}</label>
                  </th>
                  <td className="border-b border-line px-2 py-2 align-top">
                    <select
                      id={id}
                      lang="en"
                      className={fieldInput}
                      value={other ? OTHER : selectValue(value)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === OTHER) {
                          setTyping((c) => ({ ...c, [f.key]: true }));
                          setMap((c) => ({ ...c, [f.key]: known.has(value) || value === card.noteValue ? "" : value }));
                        } else {
                          setTyping((c) => ({ ...c, [f.key]: false }));
                          setMap((c) => ({ ...c, [f.key]: v }));
                        }
                      }}
                    >
                      <option value="">{t("crm.map.skip")}</option>
                      {card.usesNotes && f.key !== "name" && f.key !== "phone" && f.key !== "email" ? <option value={card.noteValue}>{t("crm.map.note")}</option> : null}
                      {card.targets.map((x) => (
                        <option key={x.field} value={x.field}>
                          {x.label}
                        </option>
                      ))}
                      <option value={OTHER}>{t("crm.map.other")}</option>
                    </select>
                    {other ? (
                      <input lang="en" aria-label={t("crm.map.other.label")} autoComplete="off" spellCheck={false} maxLength={60} placeholder={t("crm.map.other.label")} value={known.has(value) || value === card.noteValue ? "" : value} onChange={(e) => setMap((c) => ({ ...c, [f.key]: e.target.value }))} className={`${fieldInput} mt-2`} />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" disabled={busy || !changed} className={`${btnQuiet} mt-3`} onClick={() => onSave(map)}>
        {t("crm.map.save")}
      </button>
    </div>
  );
}

type RunFn = <T>(go: () => Promise<Ok<T>>, done: (r: { ok: true } & T) => void) => Promise<void>;
function Actions({ card, conn, words, busy, actions, run, setConn, setNote }: { card: Card; conn: Connection; words: Words; busy: boolean; actions: ConnectorActions; run: RunFn; setConn: (c: Connection | null) => void; setNote: (s: string | null) => void }) {
  const t = makeT(words);
  const [logOpen, setLogOpen] = React.useState(false);
  const [log, setLog] = React.useState<Deliveries | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [tested, setTested] = React.useState<{ ok: boolean; why: string | null } | null>(null);
  const why = (word: string | null): string => (word && (ERROR_WORDS as readonly string[]).includes(word) ? t(`crm.err.${word}` as "crm.err.auth") : t("crm.fail.other"));
  const more = (before: string | null) => run(() => actions.log(card.type, before), (r) => setLog((cur) => (before && cur ? { items: [...cur.items, ...r.log.items], nextBefore: r.log.nextBefore } : r.log)));
  const lastTest = tested ?? (conn.lastTest ? { ok: conn.lastTest.ok, why: conn.lastTest.reason } : null);
  return (
    <div className="flex flex-col gap-3" data-part="connector-actions">
      <div className="flex flex-wrap gap-x-1 gap-y-1">
        <button type="button" disabled={busy} className={btnMain} onClick={() => void run(() => actions.test(card.type), (r) => setTested({ ok: r.result.ok, why: r.result.reason }))}>
          {t("crm.test")}
        </button>
        <button type="button" disabled={busy} className={btnQuiet} onClick={() => void run(() => actions.change(card.type, { active: !conn.active }), (r) => setConn(r.connection))}>
          {conn.active ? t("crm.pause") : t("crm.resume")}
        </button>
        <button type="button" className={btnQuiet} onClick={() => { const next = !logOpen; setLogOpen(next); if (next && !log) void more(null); }}>
          {logOpen ? t("crm.log.hide") : t("crm.log")}
        </button>
        {conn.failing ? (
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => void run(() => actions.retry(card.type), (r) => { setNote(t("crm.retry.done", { n: r.requeued })); setLog(null); setLogOpen(false); })}>
            {t("crm.retry")}
          </button>
        ) : null}
        <button type="button" className={btnQuiet} onClick={() => setConfirm(true)}>
          {t("crm.disconnect")}
        </button>
      </div>
      {lastTest ? (
        <p role="status" className="m-0 flex items-start gap-2 text-[15px] text-ink" data-part="connector-test">
          <span aria-hidden="true" className={`mt-2 size-2 shrink-0 rounded-full ${lastTest.ok ? "bg-green-text" : "bg-brand"}`} />
          <span>{lastTest.ok ? t("crm.test.ok", { tool: card.label }) : t("crm.test.bad", { why: why(lastTest.why) })}</span>
        </p>
      ) : null}
      <p className="m-0 text-[14px] text-muted">{conn.lastDeliveredAt ? t("crm.last", { when: when(conn.lastDeliveredAt) }) : t("crm.log.none")}</p>
      {confirm ? (
        <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-muted">
          {t("crm.disconnect.t", { tool: card.label })}
          <button type="button" disabled={busy} className={btnMain} onClick={() => void run(() => actions.disconnect(card.type), () => { setConfirm(false); setConn(null); setTested(null); setLog(null); setLogOpen(false); })}>
            {t("crm.disconnect.yes")}
          </button>
          <button type="button" className={btnQuiet} onClick={() => setConfirm(false)}>
            {t("crm.cancel")}
          </button>
        </p>
      ) : null}
      {logOpen ? (
        <div data-part="connector-log">
          {log && log.items.length === 0 ? <p className="m-0 text-[15px] text-muted">{t("crm.log.none")}</p> : null}
          <ul className="m-0 flex list-none flex-col p-0">
            {(log?.items ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-2 text-[14px]">
                <span lang="en" className="font-mono text-ink">
                  {d.event}
                </span>
                <span className="text-muted">
                  {t(`crm.st.${d.status}` as "crm.st.pending")}
                  {d.result && d.status === "delivered" ? ` · ${t(`crm.res.${d.result}` as "crm.res.created")}` : ""} · {t("crm.log.tries", { n: d.attempts })}
                  {d.code ? ` · ${d.code}` : ""}
                  {d.error ? ` · ${t(`crm.err.${d.error}` as "crm.err.auth")}` : ""} · {when(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {log?.nextBefore ? (
            <button type="button" disabled={busy} className={btnQuiet} onClick={() => void more(log.nextBefore)}>
              {t("crm.log.more")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
