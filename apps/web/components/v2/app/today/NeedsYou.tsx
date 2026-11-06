"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatRupeesShort } from "@/lib/money";
import { looksLikeId } from "@/lib/lead-desk/leads";

import { FreshPhotos } from "../catalogue/FreshPhotos";
import { MessagePhotos } from "../catalogue/MessagePhotos";
import { dayShort, todayInIndia } from "../visits/dates";
import { SlotPicker } from "../visits/LazySlotPicker";
import type { SlotChoice } from "../visits/SlotPicker";
import type { DecisionResult, TodayActions } from "./actions-types";
import { useNeeds } from "./needs-store";
import { whenLabel, ago, indiaClock, indiaDay as indiaDayOf } from "./time";
import { say, type TodayWords } from "./today-words";
import type { CallCardRequest, NeedsCard, NeedsYouItem, OutboxCardMessage, Role } from "./types";

const card = "flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 md:p-5";
const badge = "rounded-full px-2.5 py-1 text-sm font-semibold";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-brand-edge bg-brand px-5 text-[15px] font-bold whitespace-nowrap text-on-brand hover:brightness-95 disabled:opacity-60";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge bg-transparent px-[18px] text-[15px] font-semibold whitespace-nowrap text-ink hover:bg-surface-2 disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center justify-center rounded-full px-[18px] text-[15px] font-semibold whitespace-nowrap text-muted hover:bg-surface-2 disabled:opacity-60";
const MAX_WORDS = 3000;

/** `who` is what the first fact is called: a customer, or (Lead Desk's plans, callbacks and limits) the plan the card is about. */
const KIND: Record<NeedsYouItem["kind"], { kind: string; step: string; tone: string; who: string }> = {
  quote_approval: { kind: "today.kind.quote", step: "today.step.quote", tone: "bg-brand-bg text-brand-text", who: "today.fact.customer" },
  followup_due: { kind: "today.kind.followup", step: "today.step.followup", tone: "bg-brand-bg text-brand-text", who: "today.fact.customer" },
  order_money_held: { kind: "today.kind.order", step: "today.step.order", tone: "bg-amber-bg text-amber-text", who: "today.fact.customer" },
  hot_lead_waiting: { kind: "today.kind.hot", step: "today.step.hot", tone: "bg-red-bg text-red-text", who: "today.fact.customer" },
  plan_waiting: { kind: "today.kind.plan", step: "today.step.plan", tone: "bg-brand-bg text-brand-text", who: "today.fact.plan" },
  callback_due: { kind: "today.kind.callback", step: "today.step.callback", tone: "bg-amber-bg text-amber-text", who: "today.fact.plan" },
  outreach_paused: { kind: "today.kind.cap", step: "today.step.cap", tone: "bg-amber-bg text-amber-text", who: "today.fact.plan" },
  prospect_waiting: { kind: "today.kind.prospect", step: "today.step.prospect", tone: "bg-amber-bg text-amber-text", who: "today.fact.customer" },
  material_quote_approval: { kind: "today.kind.quote", step: "today.step.quote", tone: "bg-brand-bg text-brand-text", who: "today.fact.customer" },
  campaign_approval: { kind: "today.kind.campaign", step: "today.step.campaign", tone: "bg-brand-bg text-brand-text", who: "today.fact.campaign" },
  fees_overdue: { kind: "today.kind.fees", step: "today.step.fees", tone: "bg-amber-bg text-amber-text", who: "today.fact.what" },
  // Cartesia voice near or past its limit (C1, 6 Nov): the API's own sentence, and Plan & usage
  voice_credits: { kind: "today.kind.voice", step: "today.step.voice", tone: "bg-amber-bg text-amber-text", who: "today.fact.what" },
};
/** The kinds whose one-line reason is made in the person's language by the server (the others' reasons are the API's English): their row shows it in every language. */
const OWN_WORDS: readonly NeedsYouItem["kind"][] = ["prospect_waiting"];

/** Which badge a message wears: what makes it wait for a person (money first, then a promise, then a complaint). */
function badgeOf(m: OutboxCardMessage | null): { key: string; tone: string } {
  if (m?.flags.includes("money")) return { key: "today.badge.price", tone: "bg-brand-bg text-brand-text" };
  if (m?.flags.includes("commitment")) return { key: "today.badge.promise", tone: "bg-amber-bg text-amber-text" };
  if (m?.flags.includes("complaint")) return { key: "today.badge.complaint", tone: "bg-red-bg text-red-text" };
  return { key: "today.badge.message", tone: "bg-surface-2 text-ink" };
}

type Ctx = { words: TodayWords; now: number; role: Role; actions: TodayActions | null; lang: string; /** A desktop draws each thing as ONE row (badge, title, short reason, buttons); "Details" opens the whole card in its place. */ compact: boolean };

const rowPrimary = "inline-flex min-h-9 max-md:min-h-11 items-center justify-center rounded-full border border-brand-edge bg-brand px-4 text-sm font-bold whitespace-nowrap text-on-brand hover:brightness-95 disabled:opacity-60";
const rowQuiet = "inline-flex min-h-9 max-md:min-h-11 items-center justify-center rounded-full border border-edge bg-transparent px-3.5 text-sm font-semibold whitespace-nowrap text-ink hover:bg-surface-2 disabled:opacity-60";

/** One thing that waits, as one line on a desktop (the owner's target, 31 Oct): its badge, "title · reason" as one line, the quick buttons on the right. The words open the whole card (with every button it has); "Details" stays for the keyboard and screen readers. The rows share ONE card (see `NeedsYou`). */
function CompactRow({ cardKey, tone, label, title, reason, tag = null, at, ctx, children, onOpen }: { cardKey: string; tone: string; label: string; title: string; reason: string; /** A small badge after the words (a prospect's "Needs OK"). */ tag?: string | null; at: string; ctx: Ctx; children?: React.ReactNode; onOpen: () => void }) {
  // a phone: the badge and the words (two lines at most) on the first line, the buttons on the line under them; a desktop: all on one line
  return (
    <div data-needs-row={cardKey} data-write className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:min-h-14 md:flex-nowrap md:py-2">
      <span className={`${badge} shrink-0 !py-0.5 !text-xs ${tone}`}>{label}</span>
      <div onClick={onOpen} title={`${title} · ${reason} · ${whenLabel(at, ctx.now)}`} className="min-w-0 flex-1 basis-40 cursor-pointer text-[15px] max-md:line-clamp-2 md:flex md:items-baseline md:gap-1.5">
        <h3 id={`needs-${cardKey}`} className="font-semibold max-md:inline md:max-w-[60%] md:shrink-0 md:truncate">
          {title}
        </h3>
        {reason ? (
          <>
            <span aria-hidden="true" className="text-muted">
              {" · "}
            </span>
            <p className="text-muted max-md:inline md:min-w-0 md:flex-1 md:truncate">{reason}</p>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 max-md:basis-full max-md:justify-end">
        {/* the small badge sits with the buttons: beside them on a desktop, on their line on a phone (never a line of its own) */}
        {tag ? (
          <span data-needs-tag="" className={`${badge} shrink-0 !py-0.5 !text-xs bg-amber-bg text-amber-text max-md:mr-auto`}>
            {tag}
          </span>
        ) : null}
        {children}
        <button type="button" data-needs="details" aria-expanded="false" aria-controls={`needs-full-${cardKey}`} onClick={onOpen} className="sr-only">
          {say(ctx.words, "today.row.details")}
        </button>
      </div>
    </div>
  );
}

function Note({ id, words }: { id: string; words: TodayWords }) {
  const { notes } = useNeeds();
  const note = notes[id];
  if (!note) return null;
  return (
    <p role="alert" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
      {note.text}
      {note.mfa ? (
        <>
          {" "}
          <Link href="/app/security" className="font-semibold underline">
            {say(words, "today.err.mfa.link")}
          </Link>
        </>
      ) : null}
    </p>
  );
}

/** Takes the card off the list at once, asks the server, and either says what happened or puts the card back with the reason. */
function useDecide(card: NeedsCard) {
  const store = useNeeds();
  const router = useRouter();
  return async (run: () => Promise<DecisionResult>) => {
    store.clearNote(card.key);
    const index = store.remove(card.key);
    let result: DecisionResult;
    try {
      result = await run();
    } catch {
      result = { ok: false, error: "" };
    }
    if (result.ok) {
      store.notify(result.message);
      return;
    }
    store.restore(card, index, { text: result.error, mfa: result.mfa === true });
    if (result.stale) router.refresh();
  };
}

function Head({ tone, label, at, ctx, onCollapse }: { tone: string; label: string; at: string; ctx: Ctx; onCollapse?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`${badge} ${tone}`}>{label}</span>
      <span className="flex items-center gap-2 text-sm text-muted">
        {whenLabel(at, ctx.now)}
        {onCollapse ? (
          <button type="button" data-needs="less" aria-expanded="true" onClick={onCollapse} className="inline-flex min-h-9 items-center rounded-full px-2.5 text-sm font-semibold text-brand-text hover:bg-surface-2">
            {say(ctx.words, "today.row.less")}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** Where a prospect's Call goes once the Owner said yes: its own row on the Prospects page with the practice call open (nothing is dialled). */
export const practiceHref = (href: string): string => `${href}${href.includes("?") ? "&" : "?"}practice=1`;

function ClassicCard({ c, item, ctx }: { c: NeedsCard; item: NeedsYouItem; ctx: Ctx }) {
  const { words } = ctx;
  const decide = useDecide(c);
  const router = useRouter();
  // a Lead Finder business (not the "N more" row): Call and Skip, as on the Prospects page (owner, 5 Nov)
  const acts = item.kind === "prospect_waiting" && item.prospect && ctx.actions?.prospect ? ctx.actions.prospect : null;
  const call = () => void decide(async () => {
    const r = await acts!.call(item.id);
    if (r.ok) router.push(practiceHref(item.href));
    return r;
  });
  const skip = () => void decide(() => acts!.skip(item.id));
  const prospectButtons = (row: boolean) =>
    acts ? (
      <>
        <button type="button" data-needs="call" onClick={call} className={row ? rowPrimary : `${primary} max-md:grow`}>
          {say(words, "lf.act.call")}
        </button>
        <button type="button" data-needs="skip" onClick={skip} className={row ? rowQuiet : quiet}>
          {say(words, "lf.act.skip")}
        </button>
      </>
    ) : null;
  const k = KIND[item.kind];
  const facts: [string, string][] = [[say(words, k.who), customerName(item.customer, words)]];
  if (item.city) facts.push([say(words, "today.fact.city"), item.city]);
  if (item.amount_paise !== null) facts.push([say(words, "today.fact.amount"), formatRupeesShort(item.amount_paise)]);
  facts.push([say(words, "today.fact.when"), ago(item.at, ctx.now)]);
  const [open, setOpen] = React.useState(false);
  const name = customerName(item.customer, words);
  // the row is SHORT (owner, 4 Nov: "Quote | Lakshmi · ₹40,000"): the amount when there is one, the hot lead's own gist (English only, as before), else just the name; the API's full sentence is in the opened card
  // a kind whose summary is OUR words (OWN_WORDS: the Lead Finder's "fit 64 · low stock") is short already and shown in every language
  const reason = item.rowLine !== undefined ? item.rowLine : OWN_WORDS.includes(item.kind) ? item.summary : item.amount_paise !== null ? formatRupeesShort(item.amount_paise) : item.kind === "hot_lead_waiting" && ctx.lang === "en" ? item.summary : item.kind === "voice_credits" ? item.summary : "";
  const tag = item.prospect?.needsOk ? say(words, "today.prospect.needsok") : null;
  if (ctx.compact && !open) {
    return (
      <CompactRow cardKey={c.key} tone={k.tone} label={say(words, `${k.kind}.row`)} title={`${name}${item.city ? `, ${item.city}` : ""}`} reason={reason} tag={tag} at={item.at} ctx={ctx} onOpen={() => setOpen(true)}>
        {acts ? (
          prospectButtons(true)
        ) : (
          <Link href={item.href} className={rowPrimary}>
            {say(words, `${k.step}.row`)}
          </Link>
        )}
      </CompactRow>
    );
  }
  return (
    <article id={`needs-full-${c.key}`} aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone={k.tone} label={say(words, k.kind)} at={item.at} ctx={ctx} onCollapse={ctx.compact ? () => setOpen(false) : undefined} />
      <h3 id={`needs-${c.key}`} className="text-lg font-semibold leading-snug">
        {customerName(item.customer, words)}
        {item.city ? `, ${item.city}` : ""}
      </h3>
      <p className="text-base text-muted [overflow-wrap:anywhere]">
        {say(words, `agent.${item.agent}`)} · {ago(item.at, ctx.now)}
      </p>
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item.summary}</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-2xl bg-surface-2 p-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0 max-w-full">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="break-words font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <Note id={c.key} words={words} />
      <div className="flex flex-wrap items-center gap-2">
        {acts ? (
          prospectButtons(false)
        ) : (
          <Link href={item.href} className={primary}>
            {say(words, k.step)}
          </Link>
        )}
        <Link href={item.href} className={`${quiet} ml-auto gap-1.5 text-brand-text`}>
          {say(words, "common.open")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <p className="text-sm text-muted">{say(words, "today.hint.nothingSent")}</p>
    </article>
  );
}

/** An amount the message names ("₹500", "Rs 500", "500 రూపాయలు"), as "₹500", or null: the row says the price without showing the message. */
const AMOUNT: readonly RegExp[] = [/₹\s?(\d[\d,]*(?:\.\d{1,2})?)/, /\brs\.?\s?(\d[\d,]*)/i, /(\d[\d,]*)\s*(?:rupees?|రూపాయ|रुपय|रुपए|रुपये|ರೂಪಾಯ)/i];
export function amountIn(text: string): string | null {
  for (const re of AMOUNT) {
    const m = re.exec(text);
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  return null;
}

/**
 * The one line of a held message's row (owner's review, 5 Nov): never the message's own words (they open with the row), a short summary in the person's language: what it is ("Price reply", "Follow-up", "Order update") and the amount
 * it names when it names one ("Price reply · ₹500").
 */
export function messageSummary(m: OutboxCardMessage, words: TodayWords): string {
  const what = m.flags.includes("money") ? "today.sum.price" : m.flags.includes("commitment") ? "today.sum.promise" : m.flags.includes("complaint") ? "today.sum.complaint" : `today.sum.${m.category}`;
  const amount = m.flags.includes("money") ? amountIn(m.text) : null;
  return amount ? `${say(words, what)} · ${amount}` : say(words, what);
}

function OutboxCard({ c, ctx }: { c: Extract<NeedsCard, { type: "outbox" }>; ctx: Ctx }) {
  const { words, actions, role } = ctx;
  const decide = useDecide(c);
  const store = useNeeds();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const m = c.message;
  const b = badgeOf(m);
  const customer = customerName(c.customer, words);
  const may = (role === "owner" || role === "admin") && actions !== null && m !== null;
  const title = say(words, `today.title.${m?.category ?? "other"}`, { customer });
  const [open, setOpen] = React.useState(false);

  const save = async () => {
    if (!actions) return;
    setBusy(true);
    setEditError(null);
    let result: DecisionResult;
    try {
      result = await actions.editMessage(c.id, draft);
    } catch {
      result = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    if (!result.ok) {
      setEditError(result.error || say(words, "today.err.generic"));
      return;
    }
    store.update(c.key, (x) => (x.type === "outbox" && x.message ? { ...x, message: { ...x.message, text: result.ok && result.text ? result.text : draft.trim() } } : x));
    setEditing(false);
    store.notify(result.message);
  };

  if (ctx.compact && !open) {
    return (
      <CompactRow cardKey={c.key} tone={b.tone} label={say(words, `${b.key}.row`)} title={title} reason={m ? messageSummary(m, words) : say(words, "today.notext")} at={c.at} ctx={ctx} onOpen={() => setOpen(true)}>
        {may ? (
          <>
            <button type="button" onClick={() => void decide(() => actions.approveMessage(c.id))} className={rowPrimary} aria-label={say(words, "today.act.approve")}>
              {say(words, "today.act.approve.row")}
            </button>
            <button type="button" onClick={() => void decide(() => actions.rejectMessage(c.id))} className={rowQuiet}>
              {say(words, "today.act.notnow")}
            </button>
          </>
        ) : null}
      </CompactRow>
    );
  }
  return (
    <article id={`needs-full-${c.key}`} aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone={b.tone} label={say(words, b.key)} at={c.at} ctx={ctx} onCollapse={ctx.compact ? () => setOpen(false) : undefined} />
      <h3 id={`needs-${c.key}`} className="text-lg font-semibold leading-snug">
        {title}
        {c.city ? <span className="font-normal text-muted"> · {c.city}</span> : null}
      </h3>
      {m === null ? (
        <p className="rounded-2xl bg-surface-2 p-3.5 text-base text-muted">{say(words, "today.notext")}</p>
      ) : editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`edit-${c.key}`} className="text-sm font-semibold">
            {say(words, "today.edit.label")}
          </label>
          <textarea id={`edit-${c.key}`} lang={m.language} value={draft} maxLength={MAX_WORDS} onChange={(e) => setDraft(e.target.value)} rows={6} className="min-h-32 w-full rounded-2xl border border-edge bg-bg p-3 text-base text-ink focus:border-brand-edge" />
          <p className="text-sm text-muted">{say(words, "today.edit.hint")}</p>
          {editError ? (
            <p role="alert" className="text-sm font-medium text-red-text">
              {editError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || draft.trim().length < 2} onClick={() => void save()} className={primary}>
              {busy ? say(words, "today.act.working") : say(words, "today.act.save")}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={quiet}>
              {say(words, "today.act.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3.5">
            {m.media.length > 0 ? (
              <div className="mb-2">
                <MessagePhotos media={m.media} words={words} size="md" />
              </div>
            ) : null}
            <p lang={m.language} className="whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
              {m.text}
            </p>
            {m.gloss ? (
              <div data-part="gloss" className="mt-2 border-t border-line pt-2">
                <p className="text-sm font-semibold text-muted">{say(words, "outbox.gloss")}</p>
                <p lang="en" className="whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
                  {m.gloss}
                </p>
              </div>
            ) : null}
            <p className="mt-2 text-sm text-muted">{say(words, "today.goes", { language: say(words, `today.lang.${m.language}`) })}</p>
          </div>
          <p className="text-sm text-muted">{say(words, "today.why", { reason: m.reasonText })}</p>
        </>
      )}
      <Note id={c.key} words={words} />
      {may && !editing ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" data-needs="approve" onClick={() => void decide(() => actions.approveMessage(c.id))} className={`${primary} max-md:grow`}>
            {say(words, "today.act.approve")}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(m.text);
              setEditError(null);
              setEditing(true);
            }}
            className={secondary}
          >
            {say(words, "today.act.edit")}
          </button>
          <button type="button" onClick={() => void decide(() => actions.rejectMessage(c.id))} className={quiet}>
            {say(words, "today.act.notnow")}
          </button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * What the call is about, in a few words, in the person's language ("price and visit"): the topics found in the request's own words (the API writes them in English) are named from the translations, so a Telugu row is Telugu all through. When no topic is
 * recognised English shows the request's own sentence; another language shows nothing rather than a line in English.
 */
const TOPICS: readonly [string, RegExp][] = [["price", /\b(price|prices|rate|rates|cost)\b/i], ["quote", /\b(quote|quotation|estimate)\b/i], ["stock", /\b(stock|availability|available)\b/i], ["order", /\border(s)?\b/i], ["delivery", /\bdeliver(y|ies)\b/i], ["visit", /\b(visit|store|shop|showroom)\b/i]];
function callReason(words: TodayWords, reason: string, lang: string): string {
  const found = TOPICS.filter(([, re]) => re.test(reason)).map(([key]) => say(words, `today.topic.${key}`));
  if (found.length === 0) return lang === "en" ? reason : "";
  return found.length === 1 ? found[0] : `${found.slice(0, -1).join(", ")} ${say(words, "today.topic.and")} ${found[found.length - 1]}`;
}

function CallCard({ c, ctx }: { c: Extract<NeedsCard, { type: "call" }>; ctx: Ctx }) {
  const { words, actions, role } = ctx;
  const decide = useDecide(c);
  const customer = customerName(c.customer, words);
  const r: CallCardRequest | null = c.request;
  const owner = role === "owner" && actions !== null;
  const [open, setOpen] = React.useState(false);
  if (ctx.compact && !open) {
    return (
      <CompactRow cardKey={c.key} tone="bg-info-bg text-info-text" label={say(words, "today.badge.call.row")} title={say(words, "today.title.call", { customer })} reason={r ? callReason(words, r.reason, ctx.lang) : ""} at={c.at} ctx={ctx} onOpen={() => setOpen(true)}>
        {owner ? (
          <>
            <button type="button" onClick={() => void decide(() => actions.approveCall(c.id))} className={rowPrimary} aria-label={say(words, "today.act.callok")}>
              {say(words, "today.act.callok.row")}
            </button>
            <button type="button" onClick={() => void decide(() => actions.offerVisit(c.id, r?.language ?? "en"))} className={rowQuiet} aria-label={say(words, "today.act.visit")}>
              {say(words, "today.act.visit.row")}
            </button>
          </>
        ) : null}
      </CompactRow>
    );
  }
  return (
    <article id={`needs-full-${c.key}`} aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone="bg-info-bg text-info-text" label={say(words, "today.badge.call")} at={c.at} ctx={ctx} onCollapse={ctx.compact ? () => setOpen(false) : undefined} />
      <h3 id={`needs-${c.key}`} className="text-lg font-semibold leading-snug">
        {say(words, "today.title.call", { customer })}
        {c.city ? <span className="font-normal text-muted"> · {c.city}</span> : null}
      </h3>
      {r ? <p lang="en" className="text-base text-muted [overflow-wrap:anywhere]">{r.reason}</p> : null}
      <Note id={c.key} words={words} />
      {owner ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void decide(() => actions.approveCall(c.id))} className={`${primary} max-md:grow`}>
            {say(words, "today.act.callok")}
          </button>
          <button type="button" onClick={() => void decide(() => actions.offerVisit(c.id, r?.language ?? "en"))} className={secondary}>
            {say(words, "today.act.visit")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">{say(words, "today.owneronly")}</p>
      )}
    </article>
  );
}

/**
 * A caller asked to talk to a person (C1 #347). "Call back" opens the lead the call belongs to (the number is there); "Done" says the team called back and takes the card off (Owner, Admin, Sales; the API checks). A call with no lead has no
 * Call back, only Done. The call's own short summary is the API's English: shown in English only, like a call request's reason.
 */
function PersonCard({ c, ctx }: { c: Extract<NeedsCard, { type: "person" }>; ctx: Ctx }) {
  const { words, actions, role } = ctx;
  const decide = useDecide(c);
  const customer = customerName(c.customer, words);
  const done = role !== "viewer" && actions?.callHandled ? actions.callHandled : null;
  const gist = c.gist && ctx.lang === "en" ? c.gist : "";
  const [open, setOpen] = React.useState(false);
  const visit = c.bookHref !== null; // a caller who agreed a visit time (C1 #354): Book is the first move
  const tone = visit ? "bg-amber-bg text-amber-text" : "bg-red-bg text-red-text";
  const when = c.visitAt ? `${dayShort(indiaDayOf(c.visitAt), ctx.lang)}, ${indiaClock(c.visitAt)}` : null;
  const title = visit ? (when ? say(words, "today.title.visitcall", { customer, when }) : say(words, "today.title.visitcall.notime", { customer })) : say(words, "today.title.person", { customer });
  const first = visit ? { href: c.bookHref as string, label: say(words, "today.act.book") } : c.leadHref ? { href: c.leadHref, label: say(words, "today.act.callback") } : null;
  if (ctx.compact && !open) {
    return (
      <CompactRow cardKey={c.key} tone={tone} label={say(words, visit ? "today.badge.visit.row" : "today.badge.person.row")} title={title} reason={gist} at={c.at} ctx={ctx} onOpen={() => setOpen(true)}>
        {first ? (
          <Link href={first.href} className={rowPrimary}>
            {first.label}
          </Link>
        ) : null}
        {done ? (
          <button type="button" onClick={() => void decide(() => done(c.id))} className={rowQuiet} aria-label={say(words, "today.act.handled")}>
            {say(words, "today.act.handled.row")}
          </button>
        ) : null}
      </CompactRow>
    );
  }
  return (
    <article id={`needs-full-${c.key}`} aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone={tone} label={say(words, visit ? "today.badge.visit" : "today.badge.person")} at={c.at} ctx={ctx} onCollapse={ctx.compact ? () => setOpen(false) : undefined} />
      <h3 id={`needs-${c.key}`} className="text-lg font-semibold leading-snug">
        {title}
        {c.city ? <span className="font-normal text-muted"> · {c.city}</span> : null}
      </h3>
      {gist ? <p lang="en" className="text-base text-muted [overflow-wrap:anywhere]">{gist}</p> : null}
      <p className="text-sm text-muted">{say(words, visit ? "today.visitcall.hint" : "today.person.hint")}</p>
      <Note id={c.key} words={words} />
      <div className="flex flex-wrap gap-2">
        {first ? (
          <Link href={first.href} className={`${primary} max-md:grow`}>
            {first.label}
          </Link>
        ) : null}
        {done ? (
          <button type="button" onClick={() => void decide(() => done(c.id))} className={secondary}>
            {say(words, "today.act.handled")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** Moves the time shown on a proposal after a move: the day and the slot are India time. */
const startsAt = (date: string, slot: string) => new Date(`${date}T${slot}:00+05:30`).toISOString();

function VisitProposalCard({ c, ctx }: { c: Extract<NeedsCard, { type: "visit" }>; ctx: Ctx }) {
  const { words, actions, role, lang, now } = ctx;
  const decide = useDecide(c);
  const store = useNeeds();
  const [moving, setMoving] = React.useState(false);
  const [pick, setPick] = React.useState<SlotChoice>({ date: indiaDayOf(c.visit.startsAt), slot: null });
  const [busy, setBusy] = React.useState(false);
  const [moveError, setMoveError] = React.useState<string | null>(null);
  const v = c.visit;
  const may = role !== "viewer" && actions !== null && actions.visit !== null;
  const today = todayInIndia(now);
  const when = `${dayShort(indiaDayOf(v.startsAt), lang)}, ${indiaClock(v.startsAt)}`;
  const facts: [string, string][] = [
    [say(words, "today.visit.when"), when],
    [say(words, "today.visit.party"), say(words, v.partySize === 1 ? "visits.party.one" : "visits.party.other", { n: v.partySize })],
  ];
  if (v.purpose) facts.push([say(words, "today.visit.purpose"), v.purpose]);
  const [open, setOpen] = React.useState(false);

  const move = async () => {
    if (!actions?.visit || pick.slot === null) return;
    setBusy(true);
    setMoveError(null);
    let result: DecisionResult;
    try {
      result = await actions.visit.move(c.id, pick.date, pick.slot);
    } catch {
      result = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    if (!result.ok) {
      setMoveError(result.error || say(words, "today.err.generic"));
      return;
    }
    const at = startsAt(pick.date, pick.slot);
    store.update(c.key, (x) => (x.type === "visit" ? { ...x, visit: { ...x.visit, startsAt: at } } : x));
    setMoving(false);
    store.notify(result.message);
  };

  if (ctx.compact && !open) {
    return (
      <CompactRow cardKey={c.key} tone="bg-amber-bg text-amber-text" label={say(words, "today.badge.visit.row")} title={say(words, "today.title.visit.proposed", { who: v.who })} reason={facts.map((f) => f[1]).join(" · ")} at={c.at} ctx={ctx} onOpen={() => setOpen(true)}>
        {may ? (
          <button type="button" onClick={() => void decide(() => actions.visit!.confirm(c.id))} className={rowPrimary} aria-label={say(words, "today.act.vconfirm")}>
            {say(words, "today.act.vconfirm.row")}
          </button>
        ) : null}
      </CompactRow>
    );
  }
  return (
    <article id={`needs-full-${c.key}`} aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone="bg-amber-bg text-amber-text" label={say(words, "today.badge.visit")} at={c.at} ctx={ctx} onCollapse={ctx.compact ? () => setOpen(false) : undefined} />
      <h3 id={`needs-${c.key}`} className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
        {say(words, "today.title.visit.proposed", { who: v.who })}
        {v.city ? <span className="font-normal text-muted"> · {v.city}</span> : null}
      </h3>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-2xl bg-surface-2 p-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0 max-w-full">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="break-words font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">{say(words, "today.visit.hint")}</p>
      <Note id={c.key} words={words} />
      {moving && actions?.visit ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3.5">
          <SlotPicker words={words} lang={lang} min={today} value={pick} onChange={setPick} load={actions.visit.slots} idPrefix={`pm-${c.key}`} />
          {moveError ? (
            <p role="alert" className="text-sm font-medium text-red-text">
              {moveError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || pick.slot === null} onClick={() => void move()} className={primary}>
              {busy ? say(words, "today.act.working") : say(words, "visits.act.move")}
            </button>
            <button type="button" disabled={busy} onClick={() => setMoving(false)} className={quiet}>
              {say(words, "today.act.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {may && !moving ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void decide(() => actions.visit!.confirm(c.id))} className={`${primary} max-md:grow`}>
            {say(words, "today.act.vconfirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setPick({ date: indiaDayOf(v.startsAt), slot: null });
              setMoveError(null);
              setMoving(true);
            }}
            className={secondary}
          >
            {say(words, "today.act.vchange")}
          </button>
          <button type="button" onClick={() => void decide(() => actions.visit!.cancel(c.id, ""))} className={quiet}>
            {say(words, "today.act.vcancel")}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function Toast({ words }: { words: TodayWords }) {
  const { toast } = useNeeds();
  void words;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-50 flex justify-center md:inset-x-auto md:bottom-6 md:right-6">
      {toast ? (
        <p key={toast.id} className="pointer-events-auto max-w-md rounded-2xl border border-line bg-charcoal px-4 py-3 text-base font-medium text-on-charcoal shadow-[var(--v2-shadow-pop)]">
          {toast.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Needs you" (job AU): the count, then one card per thing that waits. A WhatsApp message held for approval shows its exact words, the language it goes out in and why it waits, with Approve and send,
 * Edit and Not now; a request for a call has Approve call and Offer a store visit (which declines the call and queues a message offering a visit in the outbox); a visit Agent OWL proposed has Confirm, Change time and Cancel (nothing is sent to the customer by them); the three older kinds are cards that open the page that decides. A decision takes its card off the list at once and
 * a toast says what really happened ("Sent", "Approved, it goes out at 9:00", "Not sent: ..."); a refusal puts the card back with the reason. The buttons shown follow the role (a message: Owner and Admin;
 * a call: the Owner; a visit Agent OWL proposed: Owner, Admin and Sales); the API checks again. On a phone only the two newest cards show; on a desktop each thing is one row and the three newest show (so the assistant's command bar is in view under them); each with "See all". Nothing here sends a thing: the outbox does, after re-checking every rule.
 */
/**
 * Every thing that waits is ONE compact row, on a phone as on a desktop (owner, 1 Nov): badge, "Name asked for a call · price and visit", the quick buttons; "Details" (or the words) opens the whole card in its place. `compact={false}` draws the full
 * cards at once (the tests of the cards use it). At most three rows show, then "See all".
 */
export function NeedsYou({ words, role, actions, now, lang = "en", compact = true }: { words: TodayWords; role: Role; actions: TodayActions | null; now: number; lang?: string; compact?: boolean }) {
  const { cards, total, extra } = useNeeds();
  const [all, setAll] = React.useState(false);
  const ctx: Ctx = { words, now, role, actions, lang, compact };
  const draw = (c: NeedsCard, cx: Ctx) => (c.type === "item" ? <ClassicCard c={c} item={c.item} ctx={cx} /> : c.type === "outbox" ? <OutboxCard c={c} ctx={cx} /> : c.type === "visit" ? <VisitProposalCard c={c} ctx={cx} /> : c.type === "person" ? <PersonCard c={c} ctx={cx} /> : <CallCard c={c} ctx={cx} />);
  // the photo links of a catalogue send run out after ten minutes: while a card shows photos, the page reads its data again before they do
  const hasPhotos = cards?.some((c) => c.type === "outbox" && (c.message?.media.length ?? 0) > 0) === true;
  // a list that cannot be read: no section (owner's review, 5 Nov: Today never says "Not available yet"; the count in the menu stays the API's)
  if (cards === null) return null;
  return (
    <FreshPhotos seconds={hasPhotos ? 600 : null}>
    <section id="needs-you" aria-labelledby="needs-you-heading" className="flex min-w-0 scroll-mt-24 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <h2 id="needs-you-heading" className="font-display text-xl font-semibold md:text-2xl">
          {say(words, "today.needsYou")}
        </h2>
        {total !== null ? (
          <span data-count={total} className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold ${total === 0 ? "bg-surface-2 text-muted" : "bg-brand text-on-brand"}`}>
            <span aria-hidden="true">{total}</span>
            <span className="sr-only">{say(words, "today.needs.count", { n: total })}</span>
          </span>
        ) : null}
        {/* "See all (10)" whenever more rows wait than the three shown (owner, 5 Nov); its number is the badge's, the count of THINGS (a "11 more prospects" row is 11) */}
        {total !== null && cards.length > 3 ? (
          <button type="button" data-needs="see-all" aria-expanded={all} aria-controls="needs-you-list" onClick={() => setAll((v) => !v)} className="ml-auto inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand-text hover:underline">
            {all ? say(words, "today.seeless") : say(words, "today.seeall", { n: total })}
          </button>
        ) : null}
      </div>
      {cards.length === 0 && extra === 0 ? (
        <p data-empty="needs" className="flex items-center gap-2 text-sm font-medium text-muted">
          <Check className="size-4 shrink-0 text-green-text" aria-hidden="true" />
          {say(words, "today.empty")}
        </p>
      ) : (
        <>
          <ul id="needs-you-list" className={compact ? "flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface [&_article]:rounded-none [&_article]:border-0" : "flex flex-col gap-2.5"}>
            {cards.map((c, i) => (
              <li key={c.key} className={!all && i >= 3 ? "hidden" : ""}>
                {draw(c, ctx)}
              </li>
            ))}
          </ul>
          {extra > 0 && (all || cards.length <= 3) ? <p className="text-sm text-muted">{say(words, "today.needs.more", { shown: (total ?? 0) - extra, total: total ?? 0 })}</p> : null}
        </>
      )}
      <Toast words={words} />
    </section>
    </FreshPhotos>
  );
}

/** What a card calls the customer: their name; an internal placeholder ("Enquiry 92e730", an id) is never a name, it reads "New enquiry" (owner, 30 Oct and 4 Nov); none at all reads "a customer". */
export function customerName(raw: string | null | undefined, words: Parameters<typeof say>[0]): string {
  const n = (raw ?? "").trim();
  if (n === "") return say(words, "today.customer.unknown");
  return looksLikeId(n) ? say(words, "today.customer.new") : n;
}
