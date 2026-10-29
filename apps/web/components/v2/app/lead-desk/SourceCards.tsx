"use client";

import * as React from "react";

import type { Card, CardAction, CardKind, Done, EmailAddress, MetaPage, SourceError, WebsiteSnippet } from "@/lib/sources/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, okBox, surface, warnBox } from "../ui";
import { makeT, type Words } from "../words";
import { makeCardsPost, type CardsPost } from "./cards-post";
import { CopyBox } from "./CopyBox";

const BADGE: Record<Card["status"], string> = {
  connected: "bg-green-bg text-green-text",
  needs_attention: "bg-amber-bg text-amber-text",
  not_connected: "bg-surface-2 text-muted",
  coming_soon: "bg-surface-2 text-muted",
};

/**
 * Lead sources as big simple cards (job context-and-easy-sources part B): each kind of source is ONE card with a live status ("Connected · 12 leads this week") and ONE clear action: Continue with Facebook and pick the Page; paste the IndiaMART key (shown back only as a hint);
 * copy the address to forward JustDial / Sulekha mails to, with a short Gmail guide; copy a snippet or form link for the website; add a file (the existing import); WhatsApp and missed calls say what they do. A card that has a problem says so in plain words with one tap to fix it:
 * never silent. The card's own sentences come from the API as they are; the titles, buttons and answers are this app's words. Calls go to this app's own route (`endpoint`), never the API.
 */
export function SourceCards({ words, initial, endpoint, base, metaReturn, post: given }: { words?: Words; initial: Card[]; endpoint: string; base: string; metaReturn: boolean; post?: CardsPost }) {
  const t = makeT(words);
  const post = React.useMemo(() => given ?? makeCardsPost(endpoint), [given, endpoint]);
  const [cards, setCards] = React.useState(initial);
  const [open, setOpen] = React.useState<CardKind | null>(metaReturn ? "meta" : null);
  const refresh = async () => {
    const r = (await post({ op: "cards" })) as Done<Card[]>;
    if (r.ok) setCards(r.data);
  };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="cards-h" data-part="source-cards">
      <h2 id="cards-h" className="text-lg font-semibold text-ink">{t("sc.title")}</h2>
      <p className="text-sm text-muted">{t("sc.sub")}</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <li key={c.kind} className={`${surface} flex flex-col gap-3`} data-card={c.kind} data-status={c.status}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-base font-semibold text-ink">{t(`sc.${c.kind}` as "sc.meta")}</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE[c.status]}`}>{t(`sc.status.${c.status}` as "sc.status.connected")}</span>
            </div>
            <p className="text-sm text-muted">{t(`sc.${c.kind}.what` as "sc.meta.what")}</p>
            {c.detail ? <p className="text-sm text-ink">{c.detail}</p> : null}
            {c.problem ? <p className={warnBox} role="alert">{c.problem.message}</p> : null}
            {!c.available ? (
              <p className={fieldHelp}>{t("sc.unavailable")}</p>
            ) : (
              <CardBody card={c} t={t} words={words} post={post} base={base} open={open === c.kind} onOpen={(o) => setOpen(o ? c.kind : null)} onChanged={refresh} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type T = ReturnType<typeof makeT>;
const sentence = (t: T, e: SourceError) => t(`sc.err.${e}` as "sc.err.down");

function CardBody({ card, t, words, post, base, open, onOpen, onChanged }: { card: Card; t: T; words?: Words; post: CardsPost; base: string; open: boolean; onOpen: (o: boolean) => void; onChanged: () => Promise<void> }) {
  const action: CardAction = card.problem?.fix && card.problem.fix !== "none" ? card.problem.fix : card.action;
  const label = card.status === "connected" ? t("sc.manage") : card.status === "needs_attention" ? t("sc.fix") : t(`sc.act.${action}` as "sc.act.oauth");
  if (card.kind === "files") return <a href={`${base}/import`} className={`${btnMain} self-start`}>{t("sc.act.upload")}</a>;
  if (card.kind === "whatsapp") return card.status === "connected" ? null : <a href={`${base}/integrations`} className={`${btnMain} self-start`}>{t("sc.act.open")}</a>;
  if (action === "resume") return <ResumeButton card={card.kind} label={t("sc.act.resume")} t={t} post={post} onChanged={onChanged} />;
  if (action === "none" || action === "open") return null;
  return (
    <div className="flex flex-col gap-3">
      <div><button type="button" className={card.status === "connected" ? btnQuiet : btnMain} aria-expanded={open} onClick={() => onOpen(!open)}>{label}</button></div>
      {open ? <Panel card={card} action={action} t={t} words={words} post={post} onChanged={onChanged} /> : null}
    </div>
  );
}

function ResumeButton({ card, label, t, post, onChanged }: { card: CardKind; label: string; t: T; post: CardsPost; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<SourceError | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <button type="button" className={btnMain} disabled={busy} onClick={() => void (async () => { setBusy(true); setError(null); const r = (await post({ op: "resume", card })) as Done<null>; if (r.ok) await onChanged(); else setError(r.error); setBusy(false); })()}>{label}</button>
      </div>
      {error ? <p className={alertBox} role="alert">{sentence(t, error)}</p> : null}
    </div>
  );
}

function Panel({ card, action, t, words, post, onChanged }: { card: Card; action: CardAction; t: T; words?: Words; post: CardsPost; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<SourceError | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [key, setKey] = React.useState("");
  const [pages, setPages] = React.useState<MetaPage[] | null>(null);
  const [email, setEmail] = React.useState<EmailAddress | null>(null);
  const [site, setSite] = React.useState<WebsiteSnippet | null>(null);
  const run = async <R,>(body: Parameters<CardsPost>[0], then: (data: R) => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = (await post(body)) as Done<R>;
    if (r.ok) await then(r.data);
    else setError(r.error);
    setBusy(false);
  };
  // what each card shows when it opens: the Page list after Facebook, the address, the snippet
  React.useEffect(() => {
    let live = true;
    void (async () => {
      const body = card.kind === "meta" && card.status === "connected" ? { op: "meta_pages" as const } : card.kind === "email_forward" ? { op: "email" as const } : card.kind === "website" ? { op: "website" as const } : null;
      if (!body) return;
      const r = (await post(body)) as Done<MetaPage[] & EmailAddress & WebsiteSnippet>;
      if (!live) return;
      if (!r.ok) return setError(r.error);
      if (body.op === "meta_pages") setPages(r.data);
      else if (body.op === "email") setEmail(r.data);
      else setSite(r.data);
    })();
    return () => {
      live = false;
    };
  }, [card.kind, card.status, post]);

  const connected = card.status === "connected";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-2 p-4" data-panel={card.kind}>
      {action === "oauth" && !connected ? (
        <>
          <p className="text-sm text-muted">{t("sc.meta.how")}</p>
          <div>
            <button type="button" className={btnMain} disabled={busy} onClick={() => void run<string>({ op: "meta_connect" }, (url) => window.location.assign(url))}>{t("sc.meta.go")}</button>
          </div>
        </>
      ) : null}
      {card.kind === "meta" && connected ? (
        <>
          <p className="text-sm text-muted">{t("sc.meta.pick")}</p>
          <ul className="flex flex-col gap-2">
            {(pages ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{p.name}{p.selected ? ` · ${t("sc.meta.chosen")}` : ""}</span>
                {!p.selected ? <button type="button" className={btnQuiet} disabled={busy} onClick={() => void run({ op: "meta_select", pageId: p.id }, async () => { setPages((x) => (x ?? []).map((y) => ({ ...y, selected: y.id === p.id }))); await onChanged(); })}>{t("sc.meta.use")}</button> : null}
              </li>
            ))}
          </ul>
          <div><button type="button" className={btnQuiet} disabled={busy} onClick={() => void run({ op: "meta_disconnect" }, onChanged)}>{t("sc.disconnect")}</button></div>
        </>
      ) : null}
      {action === "paste_key" ? (
        <>
          <ol className="list-decimal pl-5 text-sm text-muted">
            {[1, 2, 3].map((n) => <li key={n}>{t(`sc.im.step${n}` as "sc.im.step1")}</li>)}
          </ol>
          <div>
            <label htmlFor="sc-key" className={fieldLabel}>{t("sc.im.key")}</label>
            <input id="sc-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} className={fieldInput} />
            <p className={fieldHelp}>{t("sc.im.hint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnMain} disabled={busy || key.trim().length < 4} onClick={() => void run<{ status: string; hint: string }>({ op: "indiamart_key", key }, async (d) => { setKey(""); setNote(d.status === "connected" ? t("sc.im.saved", { hint: d.hint }) : t("sc.err.badkey")); await onChanged(); })}>{t("sc.im.save")}</button>
            {connected ? <button type="button" className={btnQuiet} disabled={busy} onClick={() => void run({ op: "indiamart_disconnect" }, onChanged)}>{t("sc.disconnect")}</button> : null}
          </div>
        </>
      ) : null}
      {action === "copy_address" ? (
        <>
          <p className="text-sm text-muted">{t("sc.mail.how")}</p>
          {email ? (
            <>
              <CopyBox words={words ?? {}} id="sc-address" label={t("sc.mail.address")} value={email.address} />
              {email.confirmation ? <CopyBox words={words ?? {}} id="sc-code" label={t("sc.mail.code")} value={email.confirmation.code} /> : null}
              <ol className="list-decimal pl-5 text-sm text-muted">{email.guide.map((g) => <li key={g.step}>{g.text}</li>)}</ol>
              <div><button type="button" className={btnQuiet} disabled={busy} onClick={() => void run<EmailAddress>({ op: "email", rotate: true }, (d) => { setEmail(d); setNote(t("sc.mail.rotated")); })}>{t("sc.mail.rotate")}</button></div>
            </>
          ) : null}
        </>
      ) : null}
      {action === "copy_snippet" ? (
        <>
          <p className="text-sm text-muted">{t("sc.web.how")}</p>
          {site ? (
            <>
              <CopyBox words={words ?? {}} id="sc-snippet" label={t("sc.web.snippet")} value={site.snippet} multiline />
              {site.formLink ? <CopyBox words={words ?? {}} id="sc-form" label={t("sc.web.form")} value={site.formLink} /> : null}
            </>
          ) : null}
        </>
      ) : null}
      {error ? <p className={alertBox} role="alert">{sentence(t, error)}</p> : null}
      {note ? <p className={okBox} role="status">{note}</p> : null}
    </div>
  );
}
