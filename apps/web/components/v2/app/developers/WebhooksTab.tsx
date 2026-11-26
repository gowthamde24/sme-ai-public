"use client";

import * as React from "react";

import type { Deliveries, Endpoint, EventKind, HookFail, NewEndpoint } from "@/lib/api/webhooks-out";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import { cardBox } from "../Card";

type Ok<T> = ({ ok: true } & T) | HookFail;
export type HookActions = {
  create: (input: { url: string; events: string[]; sendTranscript: boolean }) => Promise<Ok<{ created: NewEndpoint }>>;
  change: (id: string, input: { url?: string; events?: string[]; sendTranscript?: boolean; active?: boolean }) => Promise<Ok<{ hook: Endpoint }>>;
  rotate: (id: string) => Promise<Ok<{ created: NewEndpoint }>>;
  remove: (id: string) => Promise<Ok<unknown>>;
  test: (id: string) => Promise<Ok<unknown>>;
  log: (id: string, before: string | null) => Promise<Ok<{ log: Deliveries }>>;
};

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/**
 * Settings > Developers > Webhooks (C1's docs/contracts/webhooks-out.md): the addresses (up to 5) as open rows with their health, Add an address (the events as checkboxes in the API's own words, the transcript opt-in for the Owner only), Send a test, the delivery log (status, tries,
 * the response code and a closed word, never a body), Switch off or on, New secret and Delete. A secret is held in this component's state ONLY, shown once with Copy until "I have saved it". A failing address is the neutral notice (a dot and one sentence), not an alarm.
 */
export function WebhooksTab({ words, endpoints, events, owner, actions }: { words: Words; endpoints: readonly Endpoint[]; events: readonly EventKind[]; owner: boolean; actions: HookActions }) {
  const t = makeT(words);
  const [rows, setRows] = React.useState<readonly Endpoint[]>(endpoints);
  const [form, setForm] = React.useState<{ id: string | null } | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // the list comes from the server and is replaced when it changes (a refresh after a save)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setRows(endpoints), [endpoints]);
  const say = (f: HookFail): string => (f.error === "url" ? t(`dvh.fail.${f.reason ?? "none"}` as "dvh.fail.none") : f.error === "too_many" ? t("dvh.fail.too_many") : f.error === "other" ? t("dvh.fail.unavailable") : t(`dvh.fail.${f.error}` as "dvh.fail.mfa"));
  const run = async <T,>(go: () => Promise<Ok<T>>, done: (r: { ok: true } & T) => void) => {
    setBusy(true);
    setProblem(null);
    setNote(null);
    const r = await go();
    setBusy(false);
    if (r.ok) done(r);
    else setProblem(say(r));
  };
  const swap = (h: Endpoint) => setRows((cur) => cur.map((x) => (x.id === h.id ? h : x)));
  return (
    <div className={`${cardBox} flex flex-col gap-4`} data-part="webhooks">
      <p className="m-0 text-[15px] text-muted">{t("dvh.hooks.sub")}</p>
      {secret ? <SecretOnce secret={secret} words={words} onDone={() => setSecret(null)} /> : null}
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
      {rows.length === 0 && !form ? <p className="m-0 text-[15px] text-muted">{t("dvh.none")}</p> : null}
      <ul className="m-0 flex list-none flex-col border-t border-line p-0">
        {rows.map((h) => (
          <HookRow key={h.id} h={h} words={words} events={events} owner={owner} busy={busy} editing={form?.id === h.id} onEdit={() => setForm({ id: h.id })} onCloseEdit={() => setForm(null)} actions={actions} run={run} swap={swap} setSecret={setSecret} setNote={setNote} onRemoved={(id) => setRows((c) => c.filter((x) => x.id !== id))} />
        ))}
      </ul>
      {form && form.id === null ? (
        <HookForm words={words} events={events} owner={owner} busy={busy} initial={null} onCancel={() => setForm(null)} onSave={(v) => void run(() => actions.create(v), (r) => { setRows((c) => [...c, r.created.webhook]); setSecret(r.created.secret); setForm(null); })} />
      ) : null}
      {!form && rows.length < 5 ? (
        <button type="button" onClick={() => setForm({ id: null })} className={`${btnMain} self-start`}>
          {t("dvh.add")}
        </button>
      ) : null}
    </div>
  );
}

function SecretOnce({ secret, words, onDone }: { secret: string; words: Words; onDone: () => void }) {
  const t = makeT(words);
  const [copied, setCopied] = React.useState(false);
  return (
    <div role="group" aria-label={t("dvh.secret.title")} className="flex flex-col gap-2 rounded-xl border border-ink p-4" data-part="webhook-secret">
      <h3 className="m-0 text-[17px] font-semibold text-ink">{t("dvh.secret.title")}</h3>
      <p className="m-0 text-[15px] text-muted">{t("dvh.secret.t")}</p>
      <code lang="en" className="break-all rounded-lg border border-line px-3 py-2 font-mono text-[14px] text-ink">
        {secret}
      </code>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={btnQuiet} onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setCopied(false); } }}>
          {copied ? t("dvh.secret.copied") : t("dvh.secret.copy")}
        </button>
        <button type="button" className={btnMain} onClick={onDone}>
          {t("dvh.secret.saved")}
        </button>
      </div>
    </div>
  );
}

function HookForm({ words, events, owner, busy, initial, onSave, onCancel }: { words: Words; events: readonly EventKind[]; owner: boolean; busy: boolean; initial: Endpoint | null; onSave: (v: { url: string; events: string[]; sendTranscript: boolean }) => void; onCancel: () => void }) {
  const t = makeT(words);
  const [url, setUrl] = React.useState(initial?.url ?? "https://");
  const [picked, setPicked] = React.useState<readonly string[]>(initial?.events ?? events.map((e) => e.event).filter((e) => e !== "test.ping"));
  const [transcript, setTranscript] = React.useState(initial?.sendTranscript ?? false);
  const valid = url.trim().startsWith("https://") && url.trim().length >= 12 && picked.length > 0;
  return (
    <form
      className="flex flex-col gap-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ url: url.trim(), events: [...picked], sendTranscript: owner ? transcript : (initial?.sendTranscript ?? false) });
      }}
    >
      <div className="flex flex-col">
        <label htmlFor="wh-url" className={fieldLabel}>
          {t("dvh.add.url")}
        </label>
        <input id="wh-url" lang="en" inputMode="url" autoComplete="off" spellCheck={false} maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} className={fieldInput} />
      </div>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className={fieldLabel}>{t("dvh.add.events")}</legend>
        {events.filter((e) => e.event !== "test.ping").map((e) => (
          <label key={e.event} className="flex min-h-11 items-start gap-3 py-1 text-[15px] text-ink">
            <input type="checkbox" className="mt-1 size-5" checked={picked.includes(e.event)} onChange={(x) => setPicked((c) => (x.target.checked ? [...c, e.event] : c.filter((v) => v !== e.event)))} />
            <span>
              <b lang="en" className="font-mono text-[14px]">{e.event}</b>
              <span className="block text-muted" lang="en">{e.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {owner ? (
        <label className="flex min-h-11 items-start gap-3 py-1 text-[15px] text-ink">
          <input type="checkbox" className="mt-1 size-5" checked={transcript} onChange={(x) => setTranscript(x.target.checked)} />
          <span>
            {t("dvh.add.transcript")}
            <span className="block text-muted">{t("dvh.add.transcript.t")}</span>
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || !valid} className={btnMain}>
          {t("dvh.save")}
        </button>
        <button type="button" onClick={onCancel} className={btnQuiet}>
          {t("dvh.cancel")}
        </button>
      </div>
    </form>
  );
}

type RowProps = {
  h: Endpoint;
  words: Words;
  events: readonly EventKind[];
  owner: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  actions: HookActions;
  run: <T>(go: () => Promise<Ok<T>>, done: (r: { ok: true } & T) => void) => Promise<void>;
  swap: (h: Endpoint) => void;
  setSecret: (s: string) => void;
  setNote: (s: string) => void;
  onRemoved: (id: string) => void;
};
function HookRow({ h, words, events, owner, busy, editing, onEdit, onCloseEdit, actions, run, swap, setSecret, setNote, onRemoved }: RowProps) {
  const t = makeT(words);
  const [logOpen, setLogOpen] = React.useState(false);
  const [log, setLog] = React.useState<Deliveries | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [rot, setRot] = React.useState(false);
  const more = async (before: string | null) => run(() => actions.log(h.id, before), (r) => setLog((cur) => (before && cur ? { items: [...cur.items, ...r.log.items], nextBefore: r.log.nextBefore } : r.log)));
  return (
    <li className="flex flex-col gap-2 border-b border-line py-4" data-part="webhook">
      {h.failing ? (
        <p role="status" className="m-0 flex items-start gap-2 text-[15px] font-semibold text-ink">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-brand" />
          <span>{t("dvh.failing", { url: h.url })}</span>
        </p>
      ) : null}
      <p lang="en" className="m-0 break-all font-mono text-[15px] font-semibold text-ink">
        {h.url}
      </p>
      <p lang="en" className="m-0 text-[14px] text-muted">
        {h.events.join(" · ")}
      </p>
      <p className="m-0 text-[14px] text-muted">
        {h.active ? t("dvh.row.on") : t("dvh.row.off")} · {h.lastDeliveredAt ? t("dvh.row.last", { when: when(h.lastDeliveredAt) }) : t("dvh.row.never")} · {t("dvh.row.secret", { last4: h.secretLast4 })}
      </p>
      <div className="flex flex-wrap gap-x-1 gap-y-1">
        <button type="button" disabled={busy || !h.active} className={btnQuiet} onClick={() => void run(() => actions.test(h.id), () => setNote(t("dvh.act.tested")))}>
          {t("dvh.act.test")}
        </button>
        <button type="button" className={btnQuiet} onClick={() => { const next = !logOpen; setLogOpen(next); if (next && !log) void more(null); }}>
          {logOpen ? t("dvh.act.hide") : t("dvh.act.log")}
        </button>
        <button type="button" className={btnQuiet} onClick={onEdit}>
          {t("dvh.act.edit")}
        </button>
        <button type="button" disabled={busy} className={btnQuiet} onClick={() => void run(() => actions.change(h.id, { active: !h.active }), (r) => swap(r.hook))}>
          {h.active ? t("dvh.act.pause") : t("dvh.act.resume")}
        </button>
        <button type="button" disabled={busy} className={btnQuiet} onClick={() => setRot(true)}>
          {t("dvh.act.rotate")}
        </button>
        <button type="button" className={btnQuiet} onClick={() => setConfirm(true)}>
          {t("dvh.act.delete")}
        </button>
      </div>
      {rot ? (
        <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-muted">
          {t("dvh.act.rotate.t")}
          <button type="button" disabled={busy} className={btnMain} onClick={() => { setRot(false); void run(() => actions.rotate(h.id), (r) => { swap(r.created.webhook); setSecret(r.created.secret); }); }}>
            {t("dvh.act.rotate")}
          </button>
          <button type="button" className={btnQuiet} onClick={() => setRot(false)}>
            {t("dvh.cancel")}
          </button>
        </p>
      ) : null}
      {confirm ? (
        <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-muted">
          {t("dvh.act.delete.t")}
          <button type="button" disabled={busy} className={btnMain} onClick={() => void run(() => actions.remove(h.id), () => onRemoved(h.id))}>
            {t("dvh.act.delete.yes")}
          </button>
          <button type="button" className={btnQuiet} onClick={() => setConfirm(false)}>
            {t("dvh.cancel")}
          </button>
        </p>
      ) : null}
      {editing ? <HookForm words={words} events={events} owner={owner} busy={busy} initial={h} onCancel={onCloseEdit} onSave={(v) => void run(() => actions.change(h.id, v), (r) => { swap(r.hook); onCloseEdit(); })} /> : null}
      {logOpen ? (
        <div data-part="webhook-log">
          {log && log.items.length === 0 ? <p className="m-0 text-[15px] text-muted">{t("dvh.log.none")}</p> : null}
          <ul className="m-0 flex list-none flex-col p-0">
            {(log?.items ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-2 text-[14px]">
                <span lang="en" className="font-mono text-ink">{d.event}</span>
                <span className="text-muted">
                  {t(`dvh.st.${d.status}` as "dvh.st.pending")} · {t("dvh.log.attempts", { n: d.attempts })}
                  {d.code ? ` · ${d.code}` : ""}
                  {d.error ? ` · ${t(`dvh.err.${d.error}` as "dvh.err.timeout")}` : ""} · {when(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {log?.nextBefore ? (
            <button type="button" disabled={busy} className={btnQuiet} onClick={() => void more(log.nextBefore)}>
              {t("dvh.log.more")}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
