"use client";

import { refText } from "@/lib/sources/codes";
import * as React from "react";
import { Globe, Mail, Megaphone, MessageCircle, MessageSquare, PhoneMissed, Search, ShoppingBag, Table2, Upload, type LucideIcon } from "lucide-react";

import type { PullResult } from "@/lib/lead-desk/sources/types";
import type { Card, CardAction, CardKind, ConnectInfo, Done, EmailAddress, MetaPage, SourceError, TestResult, WebsiteSnippet } from "@/lib/sources/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, okBox, warnBox } from "../ui";
import { makeT, type Words } from "../words";
import { makeCardsPost, type CardsPost } from "./cards-post";
import { ConsentTick } from "./ConsentTick";
import { CopyBox } from "./CopyBox";
import { PortalsList } from "./PortalsList";

/** The state is a dot and a word (no pill): green only when it works, orange only when it needs the owner, grey otherwise. */
const DOT: Record<Card["state"], string> = { connected: "bg-green-text", waiting: "bg-muted", needs_attention: "bg-brand", paused: "bg-muted", off: "border border-muted" };
/** A bare line icon in the category colour of what the source is (design system: no tile, no circle): ads and the web find customers, calls are blue, chats are green. */
const SOURCE_ICON: Record<CardKind, { Icon: LucideIcon; k: "call" | "chat" | "find" | "offer" }> = {
  meta: { Icon: Megaphone, k: "find" },
  indiamart: { Icon: ShoppingBag, k: "offer" },
  email_forward: { Icon: Mail, k: "find" },
  website: { Icon: Globe, k: "find" },
  files: { Icon: Upload, k: "find" },
  whatsapp: { Icon: MessageCircle, k: "chat" },
  missed_calls: { Icon: PhoneMissed, k: "call" },
  click_to_whatsapp: { Icon: MessageSquare, k: "chat" },
  google_ads: { Icon: Search, k: "find" },
  sheets: { Icon: Table2, k: "find" },
};

/**
 * Lead sources as big simple cards (job context-and-easy-sources part B): each kind of source is ONE card with a live status ("Connected · 12 leads this week") and ONE clear action: Continue with Facebook and pick the Page; paste the IndiaMART key (shown back only as a hint);
 * copy the address to forward JustDial / Sulekha mails to, with a short Gmail guide; copy a snippet or form link for the website; add a file (the existing import); WhatsApp and missed calls say what they do. A card that has a problem says so in plain words with one tap to fix it:
 * never silent. The card's own sentences come from the API as they are; the titles, buttons and answers are this app's words. Calls go to this app's own route (`endpoint`), never the API.
 */
export function SourceCards({ words, initial, endpoint, base, metaReturn, openCard = null, post: given, consentTick = false }: { /** JOBS: Connect (Facebook, the website form) waits for the round consent tick and sends `consentConfirmed`. */ consentTick?: boolean; words?: Words; initial: Card[]; endpoint: string; base: string; metaReturn: boolean; /** a card to open at once (the assistant's "connect my IndiaMART": `?card=indiamart`) */ openCard?: CardKind | null; post?: CardsPost }) {
  const t = makeT(words);
  const post = React.useMemo(() => given ?? makeCardsPost(endpoint), [given, endpoint]);
  const [cards, setCards] = React.useState(initial);
  const [open, setOpen] = React.useState<CardKind | null>(metaReturn ? "meta" : openCard);
  const refresh = async () => {
    const r = (await post({ op: "cards" })) as Done<Card[]>;
    if (r.ok) setCards(r.data);
  };
  // the one orange button of the grid is the first card that can still be connected; every other action is outlined (CSS, ds.css)
  const first = cards.findIndex((c) => c.available && c.state !== "connected");
  return (
    <section className="mt-5 flex flex-col gap-3" aria-labelledby="cards-h" data-part="source-cards">
      {/* one heading on the page (owner, 17 Nov: "Lead sources" and "Where your leads come from" said the same twice): the page's title and sub line carry it, this one is for screen readers */}
      <h2 id="cards-h" className="sr-only">{t("sc.title")}</h2>
      <ul className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3" data-part="source-grid">
        {cards.map((c, i) => {
          const { Icon, k } = SOURCE_ICON[c.kind];
          return (
          <li key={c.kind} className="flex h-full min-w-0 flex-col items-start gap-2 rounded-[14px] border border-line bg-surface p-[18px] text-left" data-card={c.kind} data-cstate={c.status} data-first={i === first ? "1" : undefined}>
            <div className="flex w-full min-w-0 items-center gap-3">
              <Icon aria-hidden="true" data-k={k} className="size-6 shrink-0" strokeWidth={1.8} />
              <h3 className="min-w-0 text-[17px] font-semibold leading-snug text-ink">{t(`sc.${c.kind}` as "sc.meta")}</h3>
            </div>
            <p className="m-0 text-[15px] leading-snug text-muted">{t(`sc.${c.kind}.what` as "sc.meta.what")}</p>
            {c.available ? (
              <p className="m-0 flex items-center gap-2 text-sm text-muted" data-part="card-state">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[c.state]}`} />
                <span className={c.state === "needs_attention" ? "font-medium text-ink" : ""}>{t(`sc.state.${c.state}` as "sc.state.connected")}</span>
              </p>
            ) : null}
            {/* one line about the leads: ours (last lead, how many this week) replaces the API's own sentence, which said the same thing again */}
            {c.state === "connected" || c.state === "waiting" ? <p className="m-0 text-sm text-ink" data-part="last-lead">{lastLead(t, c)}</p> : c.detail ? <p className="text-sm text-ink">{refText(words, c.codes?.detail, c.detail)}</p> : null}
            {c.problem ? <p className={warnBox} role="alert">{refText(words, c.codes?.problemMessage, c.problem.message)}</p> : null}
            {c.kind === "website" ? <p className={fieldHelp} data-part="website-consent">{t("sc.website.consent" as "sc.meta")}</p> : null}
            {c.kind === "website" && (c.state === "connected" || c.state === "waiting") ? <p className={fieldHelp} data-part="website-recopy">{t("sc.website.recopy")}</p> : null}
            {!c.available ? (
              <p className="m-0 text-sm text-muted" data-part="card-off">{t("sc.unavailable")}</p>
            ) : (
              <CardBody card={c} t={t} words={words} post={post} base={base} consentTick={consentTick} open={open === c.kind} onOpen={(o) => setOpen(o ? c.kind : null)} onChanged={refresh} />
            )}
          </li>
          );
        })}
      </ul>
    </section>
  );
}

type T = ReturnType<typeof makeT>;
const sentence = (t: T, e: SourceError) => t(`sc.err.${e}` as "sc.err.down");

/** What a test says: the closed results of the IndiaMART check and the e-mail parser in this app's own words; any other test says what the API says. */
function testSaid(d: TestResult, t: T): string {
  if (d.result === "key_valid") return t("sc.test.keyok");
  if (d.result === "rate_limited") return t("sc.test.slow");
  if (d.result === "lead_created" && d.portal) return t("sc.test.portal", { portal: d.portal });
  return d.message || t("sc.test.done");
}

function CardBody({ card, t, words, post, base, open, onOpen, onChanged, consentTick }: { consentTick: boolean; card: Card; t: T; words?: Words; post: CardsPost; base: string; open: boolean; onOpen: (o: boolean) => void; onChanged: () => Promise<void> }) {
  const action: CardAction = card.problem?.fix && card.problem.fix !== "none" ? card.problem.fix : card.action;
  const label = card.status === "connected" ? t("sc.manage") : card.status === "needs_attention" ? t("sc.fix") : t(`sc.act.${action}` as "sc.act.oauth");
  // the e-mail parser (slice 5) is shown the once-only way when the API gives it a Test; the older card (the address read any time) stays until then
  if (card.kind === "missed_calls" || card.kind === "google_ads" || (card.kind === "email_forward" && card.testLabel !== null)) return <AddressCard card={card} t={t} words={words} post={post} onChanged={onChanged} />;
  // Instagram and Facebook ads that open WhatsApp: nothing to connect here, test or disconnect: it is on when the business's WhatsApp is connected, else the way to connect it
  if (card.kind === "click_to_whatsapp") return card.state === "off" ? <a href={`${base}/integrations`} className={`${btnMain} self-start`}>{t("sc.act.open")}</a> : <More t={t}><CostBox card={card} t={t} post={post} onChanged={onChanged} /></More>;
  if (card.kind === "files") return <a href={`${base}/import`} className={`${btnMain} self-start`}>{t("sc.act.upload")}</a>;
  if (card.kind === "whatsapp") return card.status === "connected" ? null : <a href={`${base}/integrations`} className={`${btnMain} self-start`}>{t("sc.act.open")}</a>;
  if (action === "resume") return <ResumeButton card={card.kind} label={t("sc.act.resume")} t={t} post={post} onChanged={onChanged} />;
  if (action === "none" || action === "open") return <More t={t}><Tools card={card} t={t} words={words} post={post} onChanged={onChanged} /><CostBox card={card} t={t} post={post} onChanged={onChanged} /></More>;
  return (
    <div className="flex flex-col gap-3">
      <div><button type="button" className={card.status === "connected" ? btnQuiet : btnMain} aria-expanded={open} onClick={() => onOpen(!open)}>{label}</button></div>
      {open ? <Panel card={card} action={action} t={t} words={words} post={post} onChanged={onChanged} consentTick={consentTick} /> : null}
      {card.kind === "indiamart" && (card.state === "connected" || card.state === "waiting") ? <PullNow t={t} post={post} onChanged={onChanged} /> : null}
      <More t={t}>
        <Tools card={card} t={t} words={words} post={post} onChanged={onChanged} />
        <CostBox card={card} t={t} post={post} onChanged={onChanged} />
      </More>
    </div>
  );
}

/** The card's second-line parts (test, disconnect, what a lead costs) sit behind one quiet line, so a card shows ONE action and the rest is a tap away. */
function More({ t, children }: { t: T; children: React.ReactNode }) {
  return (
    <details className="w-full" data-part="card-more">
      <summary className="cursor-pointer text-sm text-muted underline underline-offset-4">{t("sc.card.more")}</summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  );
}

/** "Last lead 2 h ago" · "3 this week", or the honest "No lead yet" for a card that is connected and has had nothing. */
function lastLead(t: T, c: Card): string {
  if (!c.lastReceivedAt) return t("sc.never");
  const mins = Math.max(0, Math.round((Date.now() - new Date(c.lastReceivedAt).getTime()) / 60000));
  const when = mins < 2 ? t("sc.last.now") : mins < 60 ? t("sc.last.min", { n: mins }) : mins < 2880 ? t("sc.last.hour", { n: Math.round(mins / 60) }) : t("sc.last.day", { n: Math.round(mins / 1440) });
  return c.received7d > 0 ? `${when} · ${t("sc.week", { n: c.received7d })}` : when;
}

/**
 * Missed calls and Google Ads (Track D): off -> one button makes the address; the address is shown ONCE, with Copy and the three steps, because the API keeps only a hash of it (it is never in the cards). Connected -> Test, Disconnect and "Make a new address" (asks once: the old one stops at once, and the new one is shown once too). The address is only ever in this component's state, never stored or logged.
 */
function AddressCard({ card, t, words, post, onChanged }: { card: Card; t: T; words?: Words; post: CardsPost; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [shown, setShown] = React.useState<ConnectInfo | null>(null);
  const [error, setError] = React.useState<SourceError | null>(null);
  const go = async (op: "connect" | "rotate") => {
    setBusy(true);
    setError(null);
    const r = (await post({ op, card: card.kind })) as Done<ConnectInfo | null>;
    if (r.ok) {
      setShown(r.data);
      setAsking(false);
      await onChanged();
    } else setError(r.error);
    setBusy(false);
  };
  const off = card.state === "off";
  return (
    <div className="flex flex-col gap-3" data-part="address-card">
      {shown ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-2 p-4" data-panel={card.kind}>
          {shown.fields.map((f, i) => <CopyBox key={f.label} words={words ?? {}} id={`sc-addr-${card.kind}-${i}`} label={f.label} value={f.value} />)}
          <ol className="list-decimal pl-5 text-sm text-muted">{shown.steps.map((x) => <li key={x}>{x}</li>)}</ol>
          <p className={fieldHelp}>{t("sc.addr.once")}</p>
          <div><button type="button" className={btnMain} onClick={() => setShown(null)}>{t("sc.addr.done")}</button></div>
        </div>
      ) : null}
      {off ? (
        <div><button type="button" className={btnMain} disabled={busy} onClick={() => void go("connect")}>{t("sc.addr.turnon")}</button></div>
      ) : asking ? (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3" role="group" aria-label={t("sc.addr.new")}>
          <p className="text-sm text-ink">{t("sc.web.rotate.ask")}</p>
          <div className="flex gap-2">
            <button type="button" className={btnMain} disabled={busy} onClick={() => void go("rotate")}>{t("sc.web.rotate.yes")}</button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(false)}>{t("sc.disconnect.no")}</button>
          </div>
        </div>
      ) : shown ? null : (
        <div><button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(true)}>{t("sc.addr.new")}</button></div>
      )}
      {error ? <p className={alertBox} role="alert">{sentence(t, error)}</p> : null}
      {card.kind === "email_forward" ? <PortalsList words={words} post={post} address={shown?.fields[0]?.value ?? null} /> : null}
      <Tools card={card} t={t} words={words} post={post} onChanged={onChanged} />
      <CostBox card={card} t={t} post={post} onChanged={onChanged} />
    </div>
  );
}

/** "What one lead from here costs you (₹)": optional, in rupees; Reports turn it into the cost of a visit per source. Kept as paise; empty means nothing entered (nothing is sent). */
function CostBox({ card, t, post, onChanged }: { card: Card; t: T; post: CardsPost; onChanged: () => Promise<void> }) {
  const start = card.costPerLeadPaise === null ? "" : String(card.costPerLeadPaise / 100);
  const [value, setValue] = React.useState(start);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<SourceError | null>(null);
  const [done, setDone] = React.useState(false);
  if (!card.costSource || card.state === "off") return null;
  const rupees = value.trim() === "" ? null : Number(value.replace(",", "."));
  const valid = rupees !== null && Number.isFinite(rupees) && rupees >= 0 && rupees <= 100000;
  const id = `sc-cost-${card.kind}`;
  return (
    <div className="flex flex-col gap-1" data-part="cost-box">
      <label htmlFor={id} className={fieldLabel}>{t("sc.cost.label")}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} inputMode="decimal" className={`${fieldInput} max-w-40`} value={value} onChange={(e) => { setValue(e.target.value); setDone(false); }} />
        <button type="button" className={btnQuiet} disabled={busy || !valid || (card.costPerLeadPaise !== null && Math.round((rupees ?? 0) * 100) === card.costPerLeadPaise)} onClick={() => void (async () => { setBusy(true); setError(null); setDone(false); const r = (await post({ op: "cost", source: card.costSource as string, paise: Math.round((rupees ?? 0) * 100) })) as Done<null>; if (r.ok) { setDone(true); await onChanged(); } else setError(r.error); setBusy(false); })()}>{t("sc.cost.save")}</button>
      </div>
      <p className={fieldHelp}>{t("sc.cost.help")}</p>
      {error ? <p className={alertBox} role="alert">{sentence(t, error)}</p> : null}
      {done ? <p className={okBox} role="status">{t("sc.cost.saved")}</p> : null}
    </div>
  );
}

/** Test and Disconnect, the same on every card: a test makes one marked lead (or checks the key or address) and says what happened in the API's words; Disconnect asks once and keeps every lead already received. */
function Tools({ card, t, words, post, onChanged }: { card: Card; t: T; words?: Words; post: CardsPost; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [error, setError] = React.useState<SourceError | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  if (!card.canTest && !card.canDisconnect) return null;
  return (
    <div className="flex flex-col gap-2" data-part="card-tools">
      <div className="flex flex-wrap items-center gap-3">
        {card.canTest ? (
          <button type="button" className={btnQuiet} disabled={busy} onClick={() => void (async () => { setBusy(true); setError(null); setNote(null); const r = (await post({ op: "test", card: card.kind })) as Done<TestResult>; if (r.ok) { const d = r.data; if (d.result === "key_rejected") setError("badkey"); else setNote(testSaid(d, t)); await onChanged(); } else setError(r.error); setBusy(false); })()}>{refText(words, card.codes?.testLabel, card.testLabel) ?? t("sc.test")}</button>
        ) : null}
        {card.canDisconnect && !asking ? <button type="button" className="text-sm text-muted underline underline-offset-2" onClick={() => setAsking(true)}>{t("sc.disconnect")}</button> : null}
      </div>
      {asking ? (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3" role="group" aria-label={t("sc.disconnect")}>
          <p className="text-sm text-ink">{t("sc.disconnect.ask")}</p>
          <div className="flex gap-2">
            <button type="button" className={btnMain} disabled={busy} onClick={() => void (async () => { setBusy(true); setError(null); const r = (await post({ op: "disconnect", card: card.kind })) as Done<null>; if (r.ok) { setAsking(false); await onChanged(); } else setError(r.error); setBusy(false); })()}>{t("sc.disconnect.yes")}</button>
            <button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(false)}>{t("sc.disconnect.no")}</button>
          </div>
        </div>
      ) : null}
      {error ? <p className={alertBox} role="alert">{sentence(t, error)}</p> : null}
      {note ? <p className={okBox} role="status">{note}</p> : null}
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

function Panel({ card, action, t, words, post, onChanged, consentTick }: { consentTick: boolean; card: Card; action: CardAction; t: T; words?: Words; post: CardsPost; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<SourceError | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [key, setKey] = React.useState("");
  const [pages, setPages] = React.useState<MetaPage[] | null>(null);
  const [email, setEmail] = React.useState<EmailAddress | null>(null);
  const [site, setSite] = React.useState<WebsiteSnippet | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const waits = consentTick && !agreed;
  const sure = consentTick ? ({ consentConfirmed: true } as const) : {};
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
      const body = card.kind === "meta" && card.status === "connected" ? { op: "meta_pages" as const } : card.kind === "email_forward" ? { op: "email" as const } : card.kind === "website" && card.state !== "off" ? { op: "website" as const } : null;
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
  }, [card.kind, card.status, card.state, post]);

  const connected = card.status === "connected";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-2 p-4" data-panel={card.kind}>
      {action === "oauth" && !connected ? (
        <>
          <p className="text-sm text-muted">{t("sc.meta.how")}</p>
          {consentTick ? <ConsentTick words={words} id="sc-consent-meta" checked={agreed} onChange={setAgreed} /> : null}
          <div>
            <button type="button" className={btnMain} disabled={busy || waits} onClick={() => void run<string>({ op: "meta_connect", ...sure }, (url) => window.location.assign(url))}>{t("sc.meta.go")}</button>
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
            <button type="button" className={btnMain} disabled={busy || key.trim().length < 4} onClick={() => void run<{ status: string; hint: string }>({ op: "indiamart_key", key }, async (d) => { setKey(""); setNote(d.status !== "connected" ? t("sc.err.badkey") : d.hint ? t("sc.im.saved", { hint: d.hint }) : t("sc.im.saved.plain")); await onChanged(); })}>{t("sc.im.save")}</button>
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
          {card.state === "off" && consentTick ? <ConsentTick words={words} id="sc-consent-website" checked={agreed} onChange={setAgreed} /> : null}
          {card.state === "off" ? (
            <div><button type="button" className={btnMain} disabled={busy || waits} onClick={() => void run({ op: "connect", card: card.kind, ...sure }, onChanged)}>{t("sc.web.connect")}</button></div>
          ) : null}
          {site && card.state !== "off" ? (
            <>
              <CopyBox words={words ?? {}} id="sc-snippet" label={t("sc.web.snippet")} value={site.snippet} multiline />
              {site.formLink ? <CopyBox words={words ?? {}} id="sc-form" label={t("sc.web.form")} value={site.formLink} /> : null}
              {site.webhookUrl ? <CopyBox words={words ?? {}} id="sc-webhook" label={t("sc.web.webhook")} value={site.webhookUrl} /> : null}
              {asking ? (
                <div className="flex flex-col gap-2 rounded-xl bg-surface p-3" role="group" aria-label={t("sc.web.rotate")}>
                  <p className="text-sm text-ink">{t("sc.web.rotate.ask")}</p>
                  <div className="flex gap-2">
                    <button type="button" className={btnMain} disabled={busy} onClick={() => void run({ op: "rotate", card: card.kind }, async () => { setAsking(false); setSite(null); setNote(t("sc.web.rotated")); const r = (await post({ op: "website" })) as Done<WebsiteSnippet>; if (r.ok) setSite(r.data); })}>{t("sc.web.rotate.yes")}</button>
                    <button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(false)}>{t("sc.disconnect.no")}</button>
                  </div>
                </div>
              ) : (
                <div><button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(true)}>{t("sc.web.rotate")}</button></div>
              )}
            </>
          ) : null}
        </>
      ) : null}
      {error ? <p className={alertBox} role="alert">{sentence(t, error)}</p> : null}
      {note ? <p className={okBox} role="status">{note}</p> : null}
    </div>
  );
}

/** IndiaMART "Pull now" (C1, 15 Nov: there is no scheduled pull yet): asks IndiaMART for the enquiries since the last pull and says what came. IndiaMART allows about one call in five minutes: a "slow down" from the API is said in plain words. */
function PullNow({ t, post, onChanged }: { t: T; post: CardsPost; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<SourceError | null>(null);
  const [done, setDone] = React.useState<PullResult | null>(null);
  return (
    <div className="flex flex-col gap-2" data-part="pull-now">
      <div>
        <button type="button" className={btnQuiet} disabled={busy} onClick={() => void (async () => { setBusy(true); setError(null); setDone(null); const r = (await post({ op: "pull" })) as Done<PullResult>; if (r.ok) { setDone(r.data); await onChanged(); } else setError(r.error); setBusy(false); })()}>
          {busy ? t("lsrc.pulling") : t("lsrc.pull")}
        </button>
      </div>
      {done ? <p className={okBox} role="status">{t("lsrc.pull.done", { fetched: done.fetched, created: done.created, merged: done.merged, invalid: done.invalid, existing: done.existing })}</p> : null}
      {error ? <p className={alertBox} role="alert">{error === "slow" ? t("sc.pull.slow") : sentence(t, error)}</p> : null}
    </div>
  );
}
