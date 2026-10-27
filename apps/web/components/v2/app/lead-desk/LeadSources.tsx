"use client";

import Link from "next/link";
import * as React from "react";

import { consentOf, emptyConsent, type ConsentState } from "@/lib/lead-desk/imports/consent";
import { PORTALS, rupeesToPaise, type Consent, type Failure, type Out, type Portal } from "@/lib/lead-desk/imports/types";
import type { LiveSource, PullResult, Secret, SourceKind, SourceWithSecret, Unparsed } from "@/lib/lead-desk/sources/types";
import { formatRupeesShort } from "@/lib/money";

import { Pill } from "../parts";
import { btnMain, btnQuiet, cardGrid, fieldHelp, fieldInput, fieldLabel, listPlain, mutedText, okBox, pageH2, surface, tileCard, warnBox } from "../ui";
import { indiaClock, indiaDay } from "../today/time";
import { makeT, type Words } from "../words";
import { ConsentFacts } from "./ConsentFacts";
import { CopyBox } from "./CopyBox";
import { FailureNote } from "./FailureNote";

export type LeadSourcesActions = {
  create: (input: unknown) => Promise<Out<SourceWithSecret>>;
  rotate: (sourceId: string) => Promise<Out<SourceWithSecret>>;
  status: (sourceId: string, what: "pause" | "resume") => Promise<Out<LiveSource>>;
  pull: () => Promise<Out<PullResult>>;
  discard: (id: string) => Promise<Out<null>>;
};
export type LeadSourcesProps = { words: Words; base: string; test: boolean; sources: LiveSource[]; unparsed: Unparsed[]; actions: LeadSourcesActions };

type CardId = "meta" | "indiamart" | "portals" | "website" | "sheets" | "webhook";
const CARDS: readonly { id: CardId; kind: SourceKind | null; single: boolean }[] = [
  { id: "meta", kind: "meta_lead_ads", single: true },
  { id: "indiamart", kind: "indiamart", single: true },
  { id: "portals", kind: "email_forward", single: false },
  { id: "website", kind: "website_form", single: false },
  { id: "sheets", kind: null, single: false },
  { id: "webhook", kind: "webhook", single: false },
];
const whenOf = (iso: string) => `${indiaDay(iso)} ${indiaClock(iso)}`;
const DOWN: Failure = { ok: false, error: "down" };

/**
 * THE LEAD SOURCES PAGE (night 4, Lead Desk, item 4; a tab of Settings; Owner and Admin): a card for each place leads arrive from by themselves (Meta Lead Ads, IndiaMART, JustDial and other portals by e-mail, your website
 * form, Google Sheets, a webhook for Zapier / n8n / Make). Each source shows its status, its last lead, how many it received and its cost per lead, and can be paused, resumed and given a NEW address (the old one stops
 * at once: it asks first). The SECRET (the address, the e-mail address, the form snippet, Meta's callback and verify token) is shown ONCE, when the source is made and after a new address: it lives only in this
 * component's state, with a Copy button and "Copy it now: it is not shown again"; it is never written to the page's address, to storage or to a log. Below: the mails no parser could read, to discard.
 */
export function LeadSources({ words, base, test, sources: initial, unparsed: initialMail, actions }: LeadSourcesProps) {
  const t = makeT(words);
  const [sources, setSources] = React.useState<LiveSource[]>(initial);
  const [mail, setMail] = React.useState<Unparsed[]>(initialMail);
  const [secrets, setSecrets] = React.useState<Record<string, Secret | "none">>({});
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<{ at: string; f: Failure } | null>(null);
  const [pulled, setPulled] = React.useState<PullResult | null>(null);
  const [open, setOpen] = React.useState<CardId | null>(null);
  const [label, setLabel] = React.useState("");
  const [portal, setPortal] = React.useState<Portal | "any">("justdial");
  const [cost, setCost] = React.useState("");
  const [consent, setConsent] = React.useState<ConsentState>(emptyConsent);
  const newId = React.useRef<string | null>(null);

  const costPaise = rupeesToPaise(cost);
  const consentValue = consentOf(consent);
  const formOk = label.trim().length > 0 && costPaise !== null && consentValue !== "incomplete";
  const fail = (at: string, f: Failure) => setFailure({ at, f });
  const upsert = (s: LiveSource) => setSources((all) => all.map((x) => (x.id === s.id ? s : x)));

  const openForm = (id: CardId) => {
    setOpen(open === id ? null : id);
    setLabel(t(`lsrc.card.${id}.title`));
    setCost("");
    setConsent(emptyConsent());
    setFailure(null);
    newId.current = null;
  };

  async function create(card: (typeof CARDS)[number]) {
    if (!card.kind || !formOk) return;
    if (!newId.current) newId.current = crypto.randomUUID();
    setBusy(card.id);
    setFailure(null);
    let out: Out<SourceWithSecret>;
    try {
      out = await actions.create({ source_id: newId.current, kind: card.kind, label: label.trim(), portal: card.kind === "email_forward" && portal !== "any" ? portal : null, consent: consentValue as Consent | null, cost_per_lead_paise: typeof costPaise === "number" ? costPaise : null });
    } catch {
      out = DOWN;
    }
    setBusy(null);
    if (!out.ok) return fail(card.id, out);
    const { secret, ...source } = out.data;
    setSources((all) => [source, ...all.filter((x) => x.id !== source.id)]);
    setSecrets((s) => ({ ...s, [source.id]: secret ?? "none" }));
    setOpen(null);
    newId.current = null;
  }

  async function rotate(id: string) {
    setBusy(id);
    setAsking(null);
    setFailure(null);
    let out: Out<SourceWithSecret>;
    try {
      out = await actions.rotate(id);
    } catch {
      out = DOWN;
    }
    setBusy(null);
    if (!out.ok) return fail(id, out);
    const { secret, ...source } = out.data;
    upsert(source);
    setSecrets((s) => ({ ...s, [id]: secret ?? "none" }));
  }

  async function setStatus(id: string, what: "pause" | "resume") {
    setBusy(id);
    setFailure(null);
    let out: Out<LiveSource>;
    try {
      out = await actions.status(id, what);
    } catch {
      out = DOWN;
    }
    setBusy(null);
    if (!out.ok) return fail(id, out);
    upsert(out.data);
  }

  async function pull(id: string) {
    setBusy(id);
    setFailure(null);
    setPulled(null);
    let out: Out<PullResult>;
    try {
      out = await actions.pull();
    } catch {
      out = DOWN;
    }
    setBusy(null);
    if (!out.ok) return fail(id, out);
    setPulled(out.data);
  }

  async function discard(id: string) {
    setBusy(id);
    setFailure(null);
    let out: Out<null>;
    try {
      out = await actions.discard(id);
    } catch {
      out = DOWN;
    }
    setBusy(null);
    if (!out.ok) return fail("mail", out);
    setMail((m) => m.filter((x) => x.id !== id));
  }

  const forgetSecret = (id: string) =>
    setSecrets((s) => {
      const { [id]: _gone, ...rest } = s;
      void _gone;
      return rest;
    });

  return (
    <div className="mt-6 flex flex-col gap-6">
      {test ? (
        <p role="note" className="rounded-lg border border-line bg-info-bg p-3 text-sm font-medium text-info-text">
          {t("lsrc.mock")}
        </p>
      ) : null}

      <div className={cardGrid}>
        {CARDS.map((card) => {
          const mine = card.kind ? sources.filter((s) => s.kind === card.kind) : [];
          const canAdd = card.kind !== null && !(card.single && mine.length > 0);
          return (
            <section key={card.id} aria-labelledby={`lsrc-${card.id}`} className={tileCard}>
              <h2 id={`lsrc-${card.id}`} className="font-display text-lg font-bold">
                {t(`lsrc.card.${card.id}.title`)}
              </h2>
              <p className="mt-1 text-base text-muted">{t(`lsrc.card.${card.id}.body`)}</p>

              {card.kind === null ? (
                <p className="mt-3">
                  <Link href={`${base}/import`} className={btnQuiet}>
                    {t("lsrc.card.sheets.link")}
                  </Link>
                </p>
              ) : null}

              {mine.length === 0 && card.kind !== null ? <p className={mutedText}>{t("lsrc.none")}</p> : null}
              <ul className={listPlain + " !mt-3"}>
                {mine.map((s) => {
                  const secret = secrets[s.id];
                  return (
                    <li key={s.id} className="rounded-xl border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{s.label}</p>
                        <Pill tone={!s.available ? "amber" : s.status === "active" ? "green" : "neutral"}>{!s.available ? t("lsrc.status.unavailable") : t(`lsrc.status.${s.status}`)}</Pill>
                      </div>
                      {!s.available ? <p className="mt-1 text-sm text-muted">{t("lsrc.unavailable.note")}</p> : null}
                      <p className="mt-1 text-sm text-muted">{s.last_received_at ? t("lsrc.last", { when: whenOf(s.last_received_at) }) : t("lsrc.last.never")}</p>
                      <p className="text-sm text-muted">
                        {t("lsrc.received", { n: s.received_count })} · {s.cost_per_lead_paise === null ? t("lsrc.cost.none") : t("lsrc.cost", { cost: formatRupeesShort(s.cost_per_lead_paise) })}
                      </p>
                      {s.token_hint ? <p className="text-sm text-muted">{t("lsrc.hint", { hint: s.token_hint })}</p> : null}

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => void setStatus(s.id, s.status === "active" ? "pause" : "resume")}>
                          {s.status === "active" ? t("lsrc.pause") : t("lsrc.resume")}
                        </button>
                        {s.kind !== "indiamart" ? (
                          <button type="button" className={btnQuiet} disabled={busy === s.id} onClick={() => setAsking(asking === s.id ? null : s.id)}>
                            {t("lsrc.rotate")}
                          </button>
                        ) : (
                          <button type="button" className={btnMain} disabled={busy === s.id} onClick={() => void pull(s.id)}>
                            {busy === s.id ? t("lsrc.pulling") : t("lsrc.pull")}
                          </button>
                        )}
                      </div>

                      {asking === s.id ? (
                        <div role="alertdialog" aria-label={t("lsrc.rotate.ask")} className={warnBox}>
                          <p>{t("lsrc.rotate.ask")}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" className={btnMain} disabled={busy === s.id} onClick={() => void rotate(s.id)}>
                              {t("lsrc.rotate.yes")}
                            </button>
                            <button type="button" className={btnQuiet} onClick={() => setAsking(null)}>
                              {t("lsrc.rotate.no")}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {pulled && s.kind === "indiamart" ? (
                        <p role="status" className={okBox}>
                          {t("lsrc.pull.done", { fetched: pulled.fetched, created: pulled.created, merged: pulled.merged, invalid: pulled.invalid, existing: pulled.existing })}
                        </p>
                      ) : null}

                      {secret === "none" ? (
                        <div className={warnBox}>
                          <p>{s.kind === "indiamart" ? t("lsrc.secret.nothing") : t("lsrc.secret.before")}</p>
                          <button type="button" className={btnQuiet + " mt-2"} onClick={() => forgetSecret(s.id)}>
                            {t("lsrc.secret.done")}
                          </button>
                        </div>
                      ) : secret ? (
                        <SecretPanel words={words} source={s} secret={secret} onDone={() => forgetSecret(s.id)} />
                      ) : null}
                      {failure?.at === s.id ? <FailureNote words={words} failure={failure.f} /> : null}
                    </li>
                  );
                })}
              </ul>

              {canAdd ? (
                <div className="mt-3">
                  <button type="button" className={btnQuiet} aria-expanded={open === card.id} onClick={() => openForm(card.id)}>
                    {t("lsrc.set_up")}
                  </button>
                  {open === card.id ? (
                    <form
                      className="mt-3 flex flex-col gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void create(card);
                      }}
                    >
                      <div>
                        <label htmlFor={`lsrc-${card.id}-name`} className={fieldLabel}>
                          {t("lsrc.name")}
                        </label>
                        <input id={`lsrc-${card.id}-name`} className={fieldInput} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
                      </div>
                      {card.kind === "email_forward" ? (
                        <div>
                          <label htmlFor="lsrc-portal" className={fieldLabel}>
                            {t("lsrc.portal")}
                          </label>
                          <select id="lsrc-portal" className={fieldInput} value={portal} onChange={(e) => setPortal(e.target.value as Portal | "any")}>
                            {PORTALS.map((p) => (
                              <option key={p} value={p}>
                                {t(`li.tag.${p}`)}
                              </option>
                            ))}
                            <option value="any">{t("lsrc.portal.any")}</option>
                          </select>
                        </div>
                      ) : null}
                      <div>
                        <label htmlFor={`lsrc-${card.id}-cost`} className={fieldLabel}>
                          {t("li.cost.label")}
                        </label>
                        <input id={`lsrc-${card.id}-cost`} inputMode="decimal" className={fieldInput} value={cost} aria-invalid={costPaise === null} onChange={(e) => setCost(e.target.value)} />
                        <p className={fieldHelp}>{costPaise === null ? t("li.cost.bad") : t("li.cost.hint")}</p>
                      </div>
                      <ConsentFacts words={words} state={consent} onChange={setConsent} canConfirm idPrefix={`lsrc-${card.id}-consent`} hint={t("lsrc.consent.hint")} />
                      <div>
                        <button type="submit" className={btnMain} disabled={!formOk || busy === card.id}>
                          {busy === card.id ? t("lsrc.adding") : t("lsrc.add")}
                        </button>
                      </div>
                      {failure?.at === card.id ? <FailureNote words={words} failure={failure.f} /> : null}
                    </form>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <section aria-labelledby="lsrc-mail" className={surface}>
        <h2 id="lsrc-mail" className={pageH2 + " !mt-0"}>
          {t("lsrc.unparsed.title")}
        </h2>
        <p className={mutedText + " !mt-1"}>{t("lsrc.unparsed.hint")}</p>
        {mail.length === 0 ? (
          <p className={mutedText}>{t("lsrc.unparsed.empty")}</p>
        ) : (
          <ul className={listPlain}>
            {mail.map((m) => (
              <li key={m.id} className="rounded-xl border border-line p-3">
                <p className="font-semibold [overflow-wrap:anywhere]">{m.subject ?? t("lsrc.unparsed.nosubject")}</p>
                <p className="text-sm text-muted">{whenOf(m.received_at)}</p>
                <p className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{m.preview}</p>
                <button type="button" className={btnQuiet + " mt-2"} disabled={busy === m.id} onClick={() => void discard(m.id)}>
                  {t("lsrc.unparsed.discard")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {failure?.at === "mail" ? <FailureNote words={words} failure={failure.f} /> : null}
      </section>
    </div>
  );
}

/** The secret of one source, shown once with a Copy button for each part. It is read from the props only and goes nowhere else. */
function SecretPanel({ words, source, secret, onDone }: { words: Words; source: LiveSource; secret: Secret; onDone: () => void }) {
  const t = makeT(words);
  const id = `secret-${source.id}`;
  return (
    <div role="region" aria-label={t("lsrc.secret.title")} className={warnBox}>
      <p className="font-semibold">{t("lsrc.secret.title")}</p>
      <p className="mt-1 text-sm">{t("lsrc.secret.help")}</p>
      <div className="mt-3 flex flex-col gap-3">
        {source.kind === "email_forward" ? (
          secret.email_address ? (
            <CopyBox words={words} id={`${id}-mail`} label={t("lsrc.secret.email")} value={secret.email_address} />
          ) : (
            <p className="text-sm">{t("lsrc.secret.email.none")}</p>
          )
        ) : null}
        {secret.url && source.kind !== "email_forward" ? <CopyBox words={words} id={`${id}-url`} label={t("lsrc.secret.url")} value={secret.url} /> : null}
        {secret.snippet_html ? <CopyBox words={words} id={`${id}-snippet`} label={t("lsrc.secret.snippet")} value={secret.snippet_html} multiline /> : null}
        {secret.meta_callback_url ? <CopyBox words={words} id={`${id}-cb`} label={t("lsrc.secret.meta_callback")} value={secret.meta_callback_url} /> : null}
        {secret.meta_verify_token ? <CopyBox words={words} id={`${id}-vt`} label={t("lsrc.secret.meta_verify")} value={secret.meta_verify_token} /> : null}
      </div>
      <button type="button" className={btnQuiet + " mt-3"} onClick={onDone}>
        {t("lsrc.secret.done")}
      </button>
    </div>
  );
}
