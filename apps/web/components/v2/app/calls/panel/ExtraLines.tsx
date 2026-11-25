"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { ExtraLine, ExtraLines as Overview, LineActions, LineMove } from "@/lib/extra-lines/types";

import { btnMain, btnQuiet, inlineLink } from "../../ui";
import { makeT, type Say, type Words } from "../../words";

/**
 * "Add a line" on the Calls at once card (owner, 26 Nov 2026; EXTRA_LINES; docs/contracts/extra-lines.md). Owner only. The price is plain text first ("₹149 a month for each extra line. Taken from your credits."), then
 * one confirm button; no sentence with blanks, no card around it (a hairline and a little room). A refusal is one plain sentence under the button; with too few credits it has a link to add credits. The lines the Owner
 * already bought are open rows (hairlines) with what happens next ("Renews on 12 Dec", "Ends on 12 Dec. Works until then.", "Not paid yet…") and one quiet button: Cancel this line, or Keep this line. Nothing is
 * charged by the screen: the server decides, the screen explains.
 */
const ERR: Record<string, string> = { invalid: "ln.err.down", forbidden: "ln.err.forbidden", step_up: "ln.err.stepup", down: "ln.err.down", unavailable: "ln.err.unavailable", not_enough_credits: "ln.err.not_enough_credits", at_limit: "ln.err.at_limit", no_number: "ln.err.no_number", paused: "ln.err.paused", not_found: "ln.err.not_found" };

/** One press = one key (the server keeps it: the same key twice is the same line). */
const newKey = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64).padEnd(8, "0");

function day(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(d);
}

function Row({ n, line, locale, t, busy, onCancel, onKeep }: { n: number; line: ExtraLine; locale: string; t: Say; busy: boolean; onCancel: () => void; onKeep: () => void }) {
  const until = day(line.paidUntil, locale);
  const grace = line.graceUntil ? day(line.graceUntil, locale) : until;
  const note = line.status === "paused" ? t("ln.row.paused") : line.status === "grace" ? t("ln.row.grace", { date: grace }) : !line.working ? t("ln.row.getting") : line.cancelAtEnd ? t("ln.row.ends", { date: until }) : t("ln.row.renews", { date: until });
  return (
    <li data-line-row={line.id} data-status={line.status} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2.5 first:border-t">
      <span className="min-w-0 text-[15px] text-ink">
        <b className="font-semibold">{t("ln.row.name", { n })}</b>
        <small className="block text-sm text-muted">{note}</small>
      </span>
      {line.status === "paused" || line.status === "ended" ? null : (
        <button type="button" disabled={busy} onClick={line.cancelAtEnd ? onKeep : onCancel} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-ink underline underline-offset-4 disabled:opacity-60">
          {line.cancelAtEnd ? t("ln.row.keep") : t("ln.row.cancel")}
        </button>
      )}
    </li>
  );
}

export function ExtraLines({ words, overview, actions, creditsHref, locale = "en-IN", test = false }: { words: Words; overview: Overview; actions: LineActions; creditsHref: string; locale?: string; test?: boolean }) {
  const t = makeT(words);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const key = React.useRef<string | null>(null);

  const run = async (move: LineMove, added: boolean) => {
    setBusy(true);
    setFail(null);
    setDone(false);
    const r = await move();
    setBusy(false);
    if (!r.ok) {
      setFail(r.error === "unavailable" && r.reason ? r.reason : r.error);
      if (added && r.error === "unavailable") key.current = null;   // a refusal is final: the next press is a new line
      return;
    }
    if (added) {
      setOpen(false);
      setDone(true);
      key.current = null;
    }
    router.refresh();
  };
  const confirm = () => {
    key.current ??= newKey();   // the same press retried (a slow answer, a second tap) keeps its key: one line, one charge
    void run(() => actions.add(key.current as string), true);
  };

  return (
    <div data-part="extra-lines" className="mt-2">
      {overview.extra.length > 0 ? (
        <>
          <h3 className="m-0 mt-4 text-[15px] font-semibold text-ink">{t("ln.list.title")}</h3>
          <ul role="list" data-part="extra-list" className="m-0 mt-2 list-none p-0">
            {overview.extra.map((line, i) => (
              <Row key={line.id} n={i + 1} line={line} locale={locale} t={t} busy={busy} onCancel={() => void run(() => actions.cancel(line.id), false)} onKeep={() => void run(() => actions.keep(line.id), false)} />
            ))}
          </ul>
        </>
      ) : null}
      {overview.canAdd && !open ? (
        <button type="button" data-part="add-line" onClick={() => setOpen(true)} className="mt-1 inline-flex min-h-11 items-center text-base font-semibold text-ink underline underline-offset-4">
          {t("cpn.once.add")}
        </button>
      ) : null}
      {open ? (
        <div role="group" aria-labelledby="ln-add-h" data-part="add-line-confirm" className="mt-2 border-t border-line pt-3">
          <h3 id="ln-add-h" className="m-0 text-base font-semibold text-ink">
            {t("ln.add.title")}
          </h3>
          <p data-part="line-price" className="m-0 mt-1 text-[15px] text-ink">
            {t("ln.price", { price: overview.priceRupees })}
          </p>
          <p className="m-0 mt-1 text-[15px] text-muted">{t("ln.taken")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={confirm} className={btnMain}>
              {t("ln.confirm")}
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className={btnQuiet}>
              {t("ln.later")}
            </button>
          </div>
        </div>
      ) : null}
      {!overview.canAdd && overview.total >= overview.cap && overview.cap > 0 ? (
        <p data-part="lines-limit" className="m-0 mt-2 text-[15px] text-muted">
          {t("ln.err.at_limit")}
        </p>
      ) : null}
      {done ? (
        <p role="status" data-part="line-added" className="m-0 mt-2 text-[15px] font-medium text-ink">
          {t("ln.done")}
        </p>
      ) : null}
      {fail ? (
        <p role="alert" data-part="line-error" className="m-0 mt-2 text-[15px] font-medium text-red-text">
          {t((ERR[fail] ?? "ln.err.down") as "ln.err.down")}{" "}
          {fail === "not_enough_credits" ? (
            <a href={creditsHref} className={inlineLink}>
              {t("ln.credits")}
            </a>
          ) : null}
        </p>
      ) : null}
      {test ? <p className="m-0 mt-2 text-sm text-muted">{t("ln.test")}</p> : null}
    </div>
  );
}
