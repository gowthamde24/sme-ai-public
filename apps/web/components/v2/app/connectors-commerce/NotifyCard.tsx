"use client";

import * as React from "react";

import { LANGUAGES, NOTIFY_EVENTS, NOTIFY_FIELDS, type Channel, type ChannelKind, type NotifyPage } from "@/lib/api/commerce-notify";

import { btnMain, btnQuiet, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import type { CommerceActions } from "./actions";
import { CardBox, CheckField, Disconnect, Notice, Result, SelectField, TextField, useRunner, when } from "./parts";

const LANGUAGE_NAMES: Record<string, string> = { en: "English", te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ" };
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Messages out to Slack, Telegram or Microsoft Teams (docs/contracts/commerce-notify.md section C): the plain connect fields (drawn from the API's own list for the kind), then the choices (which things to hear about, which details a message may
 * carry, in which language) and a test message. The address or token is typed once and cleared the moment it is sent: it is never shown again, only its last four characters.
 */
export function NotifyCard({ channel, page, words, actions, readOnly, open, onToggle }: { channel: Channel; page: NotifyPage; words: Words; actions: CommerceActions; readOnly: boolean; open: boolean; onToggle: () => void }) {
  const t = makeT(words);
  const r = useRunner(t);
  const [ch, setCh] = React.useState<Channel>(channel);
  const meta = page.kinds.find((k) => k.id === ch.kind);
  const [secrets, setSecrets] = React.useState<Record<string, string>>({});
  const [label, setLabel] = React.useState(ch.label);
  const [tested, setTested] = React.useState<{ ok: boolean; reason: string | null } | null>(null);
  const state = !ch.connected ? "not_connected" : ch.health.status === "problem" ? "problem" : "connected";
  const off = r.busy || readOnly;
  const name = meta?.name ?? ch.kind;
  const need = (meta?.fields ?? []).every((f) => (secrets[f.key] ?? "").trim() !== "");
  return (
    <CardBox id={ch.kind} group="notify" title={name} state={state} stateText={t(`cn.state.${state === "not_connected" ? "not" : state}`)} open={open} onToggle={onToggle} openWord={t("cn.open")} closeWord={t("cn.close")}>
      {r.problem ? <Notice role="alert" tone="brand">{r.problem}</Notice> : null}
      {r.note ? <Notice role="status">{r.note}</Notice> : null}
      {!ch.connected ? (
        <form
          className="flex flex-col gap-3"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            if (!need) return;
            const sent = { ...secrets };
            setSecrets({}); // the address or token is never kept after it is sent
            void r.run(() => actions.putChannel(ch.kind, { secrets: sent, ...(label.trim() ? { label: label.trim() } : {}), fields: page.defaults }), (x) => { setCh(x.channel); r.setNote(t("cn.notify.connected")); });
          }}
        >
          <p className="m-0 text-[14px] text-muted">{t(`cn.notify.${ch.kind}.how`)}</p>
          {(meta?.fields ?? []).map((f) => (
            <TextField key={f.key} id={`${ch.kind}-${f.key}`} label={f.label} hint={f.hint} value={secrets[f.key] ?? ""} onChange={(v) => setSecrets((c) => ({ ...c, [f.key]: v }))} secret={f.key !== "chat_id"} lang="en" max={600} />
          ))}
          <TextField id={`${ch.kind}-label`} label={t("cn.notify.label")} hint={t("cn.notify.label.hint")} value={label} onChange={setLabel} max={60} />
          <div>
            <button type="submit" disabled={off || !need} className={btnMain}>
              {t("cn.connect")}
            </button>
          </div>
        </form>
      ) : (
        <Connected key={`${ch.events.join()}|${ch.fields.join()}|${ch.language}`} ch={ch} words={words} busy={off} actions={actions}
          onChannel={setCh} run={r.run} setNote={r.setNote} tested={tested} setTested={setTested} name={name} secretsDone={() => { setCh({ ...ch, connected: false }); }} />
      )}
    </CardBox>
  );
}

function Connected({ ch, words, busy, actions, onChannel, run, setNote, tested, setTested, name, secretsDone }: { ch: Channel; words: Words; busy: boolean; actions: CommerceActions; onChannel: (c: Channel) => void; run: ReturnType<typeof useRunner>["run"]; setNote: (s: string | null) => void; tested: { ok: boolean; reason: string | null } | null; setTested: (v: { ok: boolean; reason: string | null } | null) => void; name: string; secretsDone: () => void }) {
  const t = makeT(words);
  const [events, setEvents] = React.useState<string[]>(ch.events);
  const [fields, setFields] = React.useState<string[]>(ch.fields);
  const [language, setLanguage] = React.useState(ch.language);
  const changed = !same(events, ch.events) || !same(fields, ch.fields) || language !== ch.language;
  const toggle = (list: string[], set: (v: string[]) => void, key: string, on: boolean) => set(on ? [...list, key] : list.filter((k) => k !== key));
  const health = ch.health;
  return (
    <>
      <p className="m-0 flex items-start gap-2 text-[15px] text-ink" data-part="notify-health">
        <span aria-hidden="true" className={`mt-2 size-2 shrink-0 rounded-full ${health.status === "ok" ? "bg-green-text" : health.status === "problem" ? "bg-brand" : "bg-muted"}`} />
        <span>
          {health.status === "ok" ? t("cn.health.ok", { when: health.lastSentAt ? when(health.lastSentAt) : "" }) : health.status === "problem" ? t("cn.health.problem", { why: health.reason ? t(`cn.reason.${health.reason}`) : t("cn.fail.other") }) : t("cn.health.never")}
        </span>
      </p>
      <p className="m-0 text-[14px] text-muted">
        {ch.label ? `${ch.label} · ` : ""}
        {ch.last4 ? t("cn.last4", { last4: ch.last4 }) + " · " : ""}
        {t("cn.notify.counts", { sent: ch.sent, failed: ch.failed, held: ch.rateLimited })}
      </p>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-part="notify-events">
        <legend className={fieldLabel}>{t("cn.notify.events")}</legend>
        {NOTIFY_EVENTS.map((e) => (
          <CheckField key={e} id={`${ch.kind}-ev-${e}`} label={t(`cn.ev.${e}`)} checked={events.includes(e)} onChange={(on) => toggle(events, setEvents, e, on)} />
        ))}
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-part="notify-fields">
        <legend className={fieldLabel}>{t("cn.notify.fields")}</legend>
        <p className="m-0 mb-1 text-[14px] text-muted">{t("cn.notify.fields.hint")}</p>
        {NOTIFY_FIELDS.map((f) => (
          <CheckField key={f} id={`${ch.kind}-f-${f}`} label={t(`cn.nf.${f}`)} checked={fields.includes(f)} onChange={(on) => toggle(fields, setFields, f, on)} />
        ))}
      </fieldset>
      <SelectField id={`${ch.kind}-lang`} label={t("cn.notify.language")} hint={t("cn.notify.language.hint")} value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] ?? l }))} />
      <div className="flex flex-wrap gap-x-1 gap-y-1">
        <button type="button" disabled={busy} className={btnMain} onClick={() => void run(() => actions.testChannel(ch.kind), (x) => { onChannel(x.result.channel); setTested({ ok: x.result.ok, reason: x.result.reason }); })}>
          {t("cn.notify.test")}
        </button>
        <button type="button" disabled={busy || !changed} className={btnQuiet} onClick={() => void run(() => actions.putChannel(ch.kind, { events, fields, language }), (x) => { onChannel(x.channel); setNote(t("cn.saved")); })}>
          {t("cn.save.choices")}
        </button>
      </div>
      {tested ? <Result ok={tested.ok} text={tested.ok ? t("cn.notify.test.ok", { name }) : t("cn.notify.test.bad", { why: tested.reason ? t(`cn.reason.${tested.reason}`) : t("cn.fail.other") })} /> : null}
      <Disconnect words={words} name={name} busy={busy} onYes={() => void run(() => actions.disconnectChannel(ch.kind), () => { secretsDone(); setTested(null); })} />
    </>
  );
}

export const CHANNEL_ORDER: ChannelKind[] = ["slack", "telegram", "teams"];
