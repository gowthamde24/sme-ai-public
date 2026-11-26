"use client";

import { Ban, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { dncHowKey, dncReasonKey, dncRemovable, indianMobile, type DncEntry, type DncPage } from "@/lib/jobs/dnc";

import type { Reply } from "../cc/kit";
import { makeT, type Words } from "../words";

export type DncActions = {
  /** Owner and Admin; null = the Add button is not drawn. */
  add: ((phone: string) => Promise<Reply<DncEntry>>) | null;
  /** The Owner only; null = no Remove. */
  remove: ((id: string) => Promise<Reply<{ id: string }>>) | null;
};

const day = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-edge bg-surface px-4 text-[15px] font-bold text-ink disabled:opacity-60";
const btnMain = "inline-flex min-h-11 items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand disabled:opacity-60";

/**
 * The Do-Not-Call list (JOBS, mock 08 part 2): "N numbers. The assistant never calls or messages these.", a search box, "Add", and each number masked with the reason in words and the date. Remove is the Owner's alone and asks once, with the line
 * that says when a number may leave the list. Search is a plain GET form (it works before the page's script is there). A number added here shows at once, masked; nothing else of it is kept in the page.
 */
export function DoNotCallList({ page, q, words, base, actions, moreHref, lifted = null, liftedHref = null }: { page: DncPage; q: string; words: Words; base: string; actions: DncActions; moreHref: string | null; /** the numbers that came off the list (asked with `include=lifted`), or null while they are not asked for */ lifted?: readonly DncEntry[] | null; /** where "Show / Hide numbers that came off the list" goes (a plain link: it works before the page's script is there), or null = no such link */ liftedHref?: string | null }) {
  const t = makeT(words);
  const id = useId();
  const [items, setItems] = useState<DncEntry[]>(page.items);
  const [count, setCount] = useState(page.count);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function add() {
    if (!actions.add) return;
    setError(null);
    setNote(null);
    if (indianMobile(phone) === null) return setError(t("jobs.dnc.err.phone"));
    setBusy(true);
    const r = await actions.add(phone);
    setBusy(false);
    if (!r.ok) return setError(r.error || t("jobs.dnc.err.phone"));
    setItems((now) => [r.data, ...now.filter((e) => e.id !== r.data.id && e.phoneMasked !== r.data.phoneMasked)]);
    setCount((n) => n + 1);
    setPhone("");
    setAdding(false);
    setNote(t("jobs.dnc.added"));
  }

  async function remove(entry: DncEntry) {
    if (!actions.remove) return;
    setBusy(true);
    setRemoveError(null);
    const r = await actions.remove(entry.id);
    setBusy(false);
    if (!r.ok) return setRemoveError(r.error);
    setItems((now) => now.filter((e) => e.id !== entry.id));
    setCount((n) => Math.max(0, n - 1));
    setAsking(null);
    setNote(t("jobs.dnc.removed"));
  }

  const sub = count === 0 ? t("jobs.dnc.count.none") : count === 1 ? t("jobs.dnc.count.one") : t("jobs.dnc.count.many", { n: count.toLocaleString("en-IN") });
  return (
    <section data-part="dnc" aria-labelledby={`${id}-t`} className="flex max-w-3xl flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand-text">
          <Ban className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="m-0 font-display text-xl font-bold leading-tight">
            {t("jobs.dnc.title")}
          </h2>
          <p className="m-0 mt-0.5 text-[15px] text-muted" data-part="dnc-count" data-count={count}>
            {sub}
          </p>
        </div>
      </div>

      <div className="flex items-stretch gap-2">
        <form method="get" action={`${base}/do-not-call`} role="search" className="relative min-w-0 flex-1">
          <label htmlFor={`${id}-q`} className="sr-only">
            {t("jobs.dnc.search")}
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input id={`${id}-q`} name="q" type="search" inputMode="tel" defaultValue={q} maxLength={40} placeholder={t("jobs.dnc.search")} className="min-h-12 w-full rounded-xl border border-edge bg-surface pl-11 pr-3 text-base text-ink focus:border-brand-edge" />
          <button type="submit" className="sr-only">
            {t("jobs.dnc.search.go")}
          </button>
        </form>
        {actions.add ? (
          <button type="button" className={`${btn} write-ctl min-h-12`} aria-expanded={adding} onClick={() => (setAdding((o) => !o), setError(null))} data-act="dnc-add">
            <Plus aria-hidden="true" className="size-4" />
            {t("jobs.dnc.add")}
          </button>
        ) : null}
      </div>

      {adding && actions.add ? (
        <form
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
          data-part="dnc-add-form"
        >
          <label htmlFor={`${id}-p`} className="text-sm font-semibold">
            {t("jobs.dnc.add.label")}
          </label>
          <input id={`${id}-p`} type="tel" inputMode="tel" autoComplete="off" autoFocus value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={`${id}-h`} placeholder="+91 98480 12345" className="min-h-12 w-full rounded-xl border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge" />
          <p id={`${id}-h`} className="m-0 text-sm text-muted">
            {t("jobs.dnc.add.help")}
          </p>
          {error ? (
            <p role="alert" className="m-0 text-sm font-semibold text-red-text">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={`${btnMain} write-ctl`} data-act="dnc-add-save">
              {t("jobs.dnc.add.save")}
            </button>
            <button type="button" disabled={busy} className={btn} onClick={() => (setAdding(false), setError(null))}>
              {t("jobs.dnc.add.cancel")}
            </button>
          </div>
        </form>
      ) : null}
      {note ? (
        <p role="status" className="m-0 text-sm font-semibold text-green-text" data-part="dnc-note">
          {note}
        </p>
      ) : null}

      {items.length === 0 ? (
        q ? (
          <p className="m-0 text-muted" data-empty="dnc">
            {t("jobs.dnc.nomatch")}
          </p>
        ) : null
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-part="dnc-list">
          {items.map((e) => (
            <li key={e.id} data-dnc={e.id} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-[17px] font-bold tabular-nums tracking-tight" data-part="dnc-number">
                    {e.phoneMasked}
                  </p>
                  <p className="m-0 text-[15px] text-muted" data-part="dnc-reason">
                    {e.reason === "added_by_owner" && e.addedBy ? t("jobs.dnc.added_by", { name: e.addedBy }) : t(dncReasonKey(e.reason))}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm text-muted">{day(e.at)}</span>
                  {actions.remove && dncRemovable(e) && asking !== e.id ? (
                    <button type="button" className="write-ctl inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand-text underline underline-offset-4" aria-label={t("jobs.dnc.remove.aria", { number: e.phoneMasked })} onClick={() => (setAsking(e.id), setRemoveError(null))} data-act="dnc-remove">
                      {t("jobs.dnc.remove")}
                    </button>
                  ) : null}
                  {!dncRemovable(e) ? (
                    <span className="max-w-[11rem] text-right text-xs text-muted" data-part="dnc-stopped">
                      {t(e.reason === "other" ? "jobs.dnc.kept" : "jobs.dnc.stopped")}
                    </span>
                  ) : null}
                </div>
              </div>
              {asking === e.id && actions.remove && dncRemovable(e) ? (
                <div role="alertdialog" aria-label={t("jobs.dnc.remove.ask", { number: e.phoneMasked })} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3" data-part="dnc-confirm">
                  <p className="m-0 font-semibold">{t("jobs.dnc.remove.ask", { number: e.phoneMasked })}</p>
                  <p className="m-0 text-sm text-muted">{t("jobs.dnc.remove.rule")}</p>
                  {removeError ? (
                    <p role="alert" className="m-0 text-sm font-semibold text-red-text">
                      {removeError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} className={`${btnMain} write-ctl`} onClick={() => void remove(e)} data-act="dnc-remove-yes">
                      {t("jobs.dnc.remove.yes")}
                    </button>
                    <button type="button" disabled={busy} className={btn} onClick={() => setAsking(null)}>
                      {t("jobs.dnc.remove.no")}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {moreHref ? (
        <p className="m-0">
          <Link href={moreHref} prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline underline-offset-4">
            {t("jobs.dnc.more")}
          </Link>
        </p>
      ) : null}
      {liftedHref ? (
        <div data-part="dnc-lifted" className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="m-0">
            <Link href={liftedHref} prefetch={false} data-act="dnc-lifted-toggle" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline underline-offset-4">
              {t(lifted ? "jobs.dnc.lifted.hide" : "jobs.dnc.lifted.show")}
            </Link>
          </p>
          {lifted ? (
            lifted.length === 0 ? (
              <p className="m-0 text-muted" data-empty="dnc-lifted">
                {t("jobs.dnc.lifted.none")}
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0" data-part="dnc-lifted-list">
                {lifted.map((e) => (
                  <li key={e.id} data-dnc-lifted={e.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0">
                    <p className="m-0 text-[17px] font-bold tabular-nums tracking-tight">{e.phoneMasked}</p>
                    <p className="m-0 text-[15px] text-muted">{t("jobs.dnc.lifted.state")}</p>
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-muted" data-part="dnc-history">
                      {e.history.map((h, i) => (
                        <li key={`${h.at}-${i}`}>{t(dncHowKey(h.how), { date: day(h.at) })}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
      <p className="m-0 text-sm text-muted" data-part="dnc-rule">
        {t("jobs.dnc.remove.rule")}
      </p>
    </section>
  );
}
