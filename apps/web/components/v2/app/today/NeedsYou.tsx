"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatINR } from "@/design/format";

import { FreshPhotos } from "../catalogue/FreshPhotos";
import { MessagePhotos } from "../catalogue/MessagePhotos";
import { OrbMark } from "../mark/OrbMark";
import { dayShort, todayInIndia } from "../visits/dates";
import { SlotPicker, type SlotChoice } from "../visits/SlotPicker";
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

const KIND: Record<NeedsYouItem["kind"], { kind: string; step: string; tone: string }> = {
  quote_approval: { kind: "today.kind.quote", step: "today.step.quote", tone: "bg-brand-bg text-brand-text" },
  followup_due: { kind: "today.kind.followup", step: "today.step.followup", tone: "bg-brand-bg text-brand-text" },
  order_money_held: { kind: "today.kind.order", step: "today.step.order", tone: "bg-amber-bg text-amber-text" },
};

/** Which badge a message wears: what makes it wait for a person (money first, then a promise, then a complaint). */
function badgeOf(m: OutboxCardMessage | null): { key: string; tone: string } {
  if (m?.flags.includes("money")) return { key: "today.badge.price", tone: "bg-brand-bg text-brand-text" };
  if (m?.flags.includes("commitment")) return { key: "today.badge.promise", tone: "bg-amber-bg text-amber-text" };
  if (m?.flags.includes("complaint")) return { key: "today.badge.complaint", tone: "bg-red-bg text-red-text" };
  return { key: "today.badge.message", tone: "bg-surface-2 text-ink" };
}

type Ctx = { words: TodayWords; now: number; role: Role; actions: TodayActions | null; lang: string };

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

function Head({ tone, label, at, ctx }: { tone: string; label: string; at: string; ctx: Ctx }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`${badge} ${tone}`}>{label}</span>
      <span className="text-sm text-muted">{whenLabel(at, ctx.now)}</span>
    </div>
  );
}

function ClassicCard({ c, item, ctx }: { c: NeedsCard; item: NeedsYouItem; ctx: Ctx }) {
  const { words } = ctx;
  const k = KIND[item.kind];
  const facts: [string, string][] = [[say(words, "today.fact.customer"), item.customer]];
  if (item.city) facts.push([say(words, "today.fact.city"), item.city]);
  if (item.amount_paise !== null) facts.push([say(words, "today.fact.amount"), formatINR(item.amount_paise / 100, { decimals: 2 })]);
  facts.push([say(words, "today.fact.when"), ago(item.at, ctx.now)]);
  return (
    <article aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone={k.tone} label={say(words, k.kind)} at={item.at} ctx={ctx} />
      <h3 id={`needs-${c.key}`} className="text-lg font-semibold leading-snug">
        {item.customer}
        {item.city ? `, ${item.city}` : ""}
      </h3>
      <p className="text-base text-muted [overflow-wrap:anywhere]">
        {say(words, `agent.${item.agent}`)} · {ago(item.at, ctx.now)}
      </p>
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item.summary}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-surface-2 p-3 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="break-words font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={item.href} className={primary}>
          {say(words, k.step)}
        </Link>
        <Link href={item.href} className={`${quiet} ml-auto gap-1.5 text-brand-text`}>
          {say(words, "common.open")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <p className="text-sm text-muted">{say(words, "today.hint.nothingSent")}</p>
    </article>
  );
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
  const customer = c.customer ?? say(words, "today.customer.unknown");
  const may = (role === "owner" || role === "admin") && actions !== null && m !== null;
  const title = say(words, `today.title.${m?.category ?? "other"}`, { customer });

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

  return (
    <article aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone={b.tone} label={say(words, b.key)} at={c.at} ctx={ctx} />
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
          <button type="button" onClick={() => void decide(() => actions.approveMessage(c.id))} className={`${primary} max-md:grow`}>
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

function CallCard({ c, ctx }: { c: Extract<NeedsCard, { type: "call" }>; ctx: Ctx }) {
  const { words, actions, role } = ctx;
  const decide = useDecide(c);
  const customer = c.customer ?? say(words, "today.customer.unknown");
  const r: CallCardRequest | null = c.request;
  const owner = role === "owner" && actions !== null;
  return (
    <article aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone="bg-info-bg text-info-text" label={say(words, "today.badge.call")} at={c.at} ctx={ctx} />
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

  return (
    <article aria-labelledby={`needs-${c.key}`} data-write className={card}>
      <Head tone="bg-amber-bg text-amber-text" label={say(words, "today.badge.visit")} at={c.at} ctx={ctx} />
      <h3 id={`needs-${c.key}`} className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
        {say(words, "today.title.visit.proposed", { who: v.who })}
        {v.city ? <span className="font-normal text-muted"> · {v.city}</span> : null}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-surface-2 p-3 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
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
 * a call: the Owner; a visit Agent OWL proposed: Owner, Admin and Sales); the API checks again. On a phone only the two newest cards show, with "See all". Nothing here sends a thing: the outbox does, after re-checking every rule.
 */
export function NeedsYou({ words, role, actions, now, lang = "en" }: { words: TodayWords; role: Role; actions: TodayActions | null; now: number; lang?: string }) {
  const { cards, total, extra } = useNeeds();
  const [all, setAll] = React.useState(false);
  const ctx: Ctx = { words, now, role, actions, lang };
  // the photo links of a catalogue send run out after ten minutes: while a card shows photos, the page reads its data again before they do
  const hasPhotos = cards?.some((c) => c.type === "outbox" && (c.message?.media.length ?? 0) > 0) === true;
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
        {cards !== null && cards.length > 2 ? (
          <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className="ml-auto inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand-text hover:underline md:hidden">
            {all ? say(words, "today.seeless") : say(words, "today.seeall", { n: cards.length })}
          </button>
        ) : null}
      </div>
      {cards === null ? (
        <div className={card}>
          <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
        </div>
      ) : cards.length === 0 ? (
        <div className={`${card} flex-row items-center`} data-empty="needs">
          <OrbMark px={56} mood={"idle"} className="size-14" />
          <p className="font-medium">{say(words, "today.empty")}</p>
        </div>
      ) : (
        <>
          <p className="mb-1 text-sm text-muted">{say(words, "today.needs.note")}</p>
          <ul className="flex flex-col gap-3">
            {cards.map((c, i) => (
              <li key={c.key} className={!all && i >= 2 ? "max-md:hidden" : ""}>
                {c.type === "item" ? <ClassicCard c={c} item={c.item} ctx={ctx} /> : c.type === "outbox" ? <OutboxCard c={c} ctx={ctx} /> : c.type === "visit" ? <VisitProposalCard c={c} ctx={ctx} /> : <CallCard c={c} ctx={ctx} />}
              </li>
            ))}
          </ul>
          {extra > 0 ? <p className="text-sm text-muted">{say(words, "today.needs.more", { shown: cards.length, total: cards.length + extra })}</p> : null}
        </>
      )}
      <Toast words={words} />
    </section>
    </FreshPhotos>
  );
}
