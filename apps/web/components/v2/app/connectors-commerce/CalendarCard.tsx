"use client";

import * as React from "react";

import type { Calendar, CalendarKind, CalendarSetup } from "@/lib/api/commerce-notify";

import { btnMain, btnQuiet } from "../ui";
import { makeT, type Words } from "../words";
import type { CommerceActions } from "./actions";
import { CardBox, CheckField, CopyField, Disconnect, Notice, TextField, useRunner, when } from "./parts";

const NAMES: Record<CalendarKind, string> = { calendly: "Calendly", calcom: "Cal.com", outlook: "Outlook / Microsoft 365" };

/**
 * A calendar (docs/contracts/commerce-notify.md section D). Calendly and Cal.com: a booking made on the owner's own page arrives here and becomes a visit (and a lead, ask-first unless the owner names a consent question); Outlook: the
 * owner's own calendar, with its busy times blocking our slots. Outlook says "Needs setup by us" until Stack19 has registered its Microsoft app. A token typed here is sent once and cleared; Cal.com's address and secret are shown once.
 */
export function CalendarCard({ calendar, words, actions, readOnly, open, onToggle }: { calendar: Calendar; words: Words; actions: CommerceActions; readOnly: boolean; open: boolean; onToggle: () => void }) {
  const t = makeT(words);
  const r = useRunner(t);
  const [cal, setCal] = React.useState<Calendar>(calendar);
  const [setup, setSetup] = React.useState<CalendarSetup | null>(null);
  const kind = cal.kind;
  const state = cal.state === "needs_setup" ? "needs_setup" : cal.state === "connected" ? (cal.health === "ok" ? "connected" : "problem") : "not_connected";
  const stateText = t(state === "not_connected" ? "cn.state.not" : state === "needs_setup" ? "cn.state.setup" : state === "problem" ? "cn.state.problem" : "cn.state.connected");
  const off = r.busy || readOnly;
  return (
    <CardBox id={kind} group="calendars" title={NAMES[kind]} state={state} stateText={stateText} open={open} onToggle={onToggle} openWord={t("cn.open")} closeWord={t("cn.close")}>
      {r.problem ? <Notice role="alert" tone="brand">{r.problem}</Notice> : null}
      {r.note ? <Notice role="status">{r.note}</Notice> : null}
      {setup ? (
        <div className="flex flex-col gap-3 border-y border-line py-3" data-part="calcom-setup">
          <Notice tone="brand" role="status">{t("cn.cal.calcom.paste")}</Notice>
          <CopyField words={words} id="calcom-url" label={t("cn.manual.address")} value={setup.webhookUrl} lang="en" />
          <CopyField words={words} id="calcom-secret" label={t("cn.manual.secret")} value={setup.secret} lang="en" />
          {setup.steps.length > 0 ? (
            <ol lang="en" className="m-0 list-decimal pl-5 text-[15px] text-muted">
              {setup.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          ) : null}
          <p className="m-0 text-[14px] text-muted">{t("cn.manual.once")}</p>
          <div>
            <button type="button" className={btnQuiet} onClick={() => setSetup(null)}>
              {t("cn.manual.done")}
            </button>
          </div>
        </div>
      ) : null}
      {cal.state === "needs_setup" ? (
        <Notice role="status">{t("cn.cal.outlook.setup")}</Notice>
      ) : cal.state === "not_connected" ? (
        <Connect cal={cal} words={words} busy={off} actions={actions} run={r.run} onSaved={(c, s) => { setCal(c); setSetup(s); r.setNote(t("cn.cal.connected")); }} />
      ) : (
        <>
          {cal.health === "needs_reconnect" ? <Notice tone="brand" role="status">{t("cn.cal.reconnect")}</Notice> : cal.health === "attention" ? <Notice tone="brand" role="status">{t("cn.cal.attention")}</Notice> : null}
          <p className="m-0 text-[14px] text-muted" data-part="calendar-facts">
            {cal.label ? `${cal.label} · ` : ""}
            {kind === "outlook" ? (cal.lastSyncedAt ? t("cn.cal.synced", { when: when(cal.lastSyncedAt) }) : t("cn.cal.notsynced")) : t("cn.cal.counts", { booked: cal.booked, cancelled: cal.cancelled })}
            {kind !== "outlook" ? ` · ${cal.lastEventAt ? t("cn.shop.last", { when: when(cal.lastEventAt) }) : t("cn.shop.none")}` : ""}
          </p>
          {cal.needsPerson > 0 ? <Notice role="status">{t("cn.cal.needs", { n: cal.needsPerson })}</Notice> : null}
          <Settings quiet={kind === "outlook" && cal.health === "needs_reconnect"} key={JSON.stringify([cal.bookingLink, cal.shareLink, cal.consentQuestion, cal.writeEvents, cal.blockBusy])} cal={cal} words={words} busy={off} onSave={(patch) => void r.run(() => actions.changeCalendar(kind, patch), (x) => { setCal(x.calendar); r.setNote(t("cn.saved")); })} />
          {cal.health === "needs_reconnect" && kind === "outlook" ? (
            <div>
              <button type="button" disabled={off} className={btnMain} onClick={() => void r.run(() => actions.startOutlook(), (x) => window.location.assign(x.url))}>
                {t("cn.cal.again")}
              </button>
            </div>
          ) : null}
          <Disconnect words={words} name={NAMES[kind]} busy={off} onYes={() => void r.run(() => actions.disconnectCalendar(kind), () => { setCal({ ...cal, state: "not_connected", label: "", bookingLink: "", shareLink: false, consentQuestion: "", writeEvents: false, blockBusy: false, health: "ok" }); })} />
        </>
      )}
    </CardBox>
  );
}

function Connect({ cal, words, busy, actions, run, onSaved }: { cal: Calendar; words: Words; busy: boolean; actions: CommerceActions; run: ReturnType<typeof useRunner>["run"]; onSaved: (c: Calendar, s: CalendarSetup | null) => void }) {
  const t = makeT(words);
  const [token, setToken] = React.useState("");
  const [link, setLink] = React.useState("");
  const [label, setLabel] = React.useState("");
  if (cal.kind === "outlook") {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[15px] text-muted">{t("cn.cal.outlook.how")}</p>
        <div>
          <button type="button" disabled={busy} className={btnMain} onClick={() => void run(() => actions.startOutlook(), (x) => window.location.assign(x.url))}>
            {t("cn.cal.outlook.connect")}
          </button>
        </div>
      </div>
    );
  }
  const calendly = cal.kind === "calendly";
  const valid = calendly ? token.trim().length >= 8 : true;
  return (
    <form
      className="flex flex-col gap-3"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const sent = { token: token.trim(), link: link.trim(), label: label.trim() };
        setToken(""); // the token is never kept after it is sent
        void run(() => (calendly ? actions.connectCalendly({ accessToken: sent.token, ...(sent.link ? { bookingLink: sent.link } : {}) }) : actions.connectCalcom({ ...(sent.link ? { bookingLink: sent.link } : {}), ...(sent.label ? { label: sent.label } : {}) })), (x) => onSaved(x.saved.calendar, x.saved.setup));
      }}
    >
      <p className="m-0 text-[14px] text-muted">{t(calendly ? "cn.cal.calendly.how" : "cn.cal.calcom.how")}</p>
      {calendly ? <TextField id="calendly-token" label={t("cn.cal.calendly.token")} hint={t("cn.cal.calendly.token.hint")} value={token} onChange={setToken} secret lang="en" max={600} /> : <TextField id="calcom-label" label={t("cn.cal.label")} hint={t("cn.cal.label.hint")} value={label} onChange={setLabel} max={60} />}
      <TextField id={`${cal.kind}-link`} label={t("cn.cal.link")} hint={t("cn.cal.link.hint")} value={link} onChange={setLink} lang="en" placeholder={calendly ? "https://calendly.com/your-name/visit" : "https://cal.com/your-name/visit"} />
      <div>
        <button type="submit" disabled={busy || !valid} className={btnMain}>
          {t("cn.connect")}
        </button>
      </div>
    </form>
  );
}

function Settings({ cal, words, busy, quiet, onSave }: { cal: Calendar; words: Words; busy: boolean; quiet: boolean; onSave: (patch: Record<string, string | boolean>) => void }) {
  const t = makeT(words);
  const [link, setLink] = React.useState(cal.bookingLink);
  const [share, setShare] = React.useState(cal.shareLink);
  const [question, setQuestion] = React.useState(cal.consentQuestion);
  const [write, setWrite] = React.useState(cal.writeEvents);
  const [block, setBlock] = React.useState(cal.blockBusy);
  const patch: Record<string, string | boolean> = {};
  if (cal.kind !== "outlook") {
    if (link.trim() !== cal.bookingLink) patch.booking_link = link.trim();
    if (share !== cal.shareLink) patch.share_link = share;
    if (question.trim() !== cal.consentQuestion) patch.consent_question = question.trim();
  } else {
    if (write !== cal.writeEvents) patch.write_events = write;
    if (block !== cal.blockBusy) patch.block_busy = block;
  }
  const validQuestion = question.trim() === "" || (question.trim().length >= 10 && question.trim().length <= 200);
  return (
    <div className="flex flex-col gap-3" data-part="calendar-settings">
      {cal.kind !== "outlook" ? (
        <>
          <TextField id={`${cal.kind}-set-link`} label={t("cn.cal.link")} hint={t("cn.cal.link.hint")} value={link} onChange={setLink} lang="en" />
          <CheckField id={`${cal.kind}-share`} label={t("cn.cal.share")} hint={t("cn.cal.share.hint")} checked={share} onChange={setShare} disabled={link.trim() === ""} />
          <TextField id={`${cal.kind}-consent`} label={t("cn.cal.consent")} hint={t("cn.cal.consent.hint")} value={question} onChange={setQuestion} max={200} />
          <p className="m-0 text-[14px] text-muted">{t("cn.cal.needs.note")}</p>
        </>
      ) : (
        <>
          <CheckField id="outlook-write" label={t("cn.cal.write")} hint={t("cn.cal.write.hint")} checked={write} onChange={setWrite} />
          <CheckField id="outlook-block" label={t("cn.cal.block")} hint={t("cn.cal.block.hint")} checked={block} onChange={setBlock} />
        </>
      )}
      <div>
        <button type="button" disabled={busy || Object.keys(patch).length === 0 || !validQuestion} className={quiet ? btnQuiet : btnMain} onClick={() => onSave(patch)}>
          {t("cn.save.choices")}
        </button>
      </div>
    </div>
  );
}
