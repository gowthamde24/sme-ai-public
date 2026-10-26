"use client";

import { useState, useTransition } from "react";

import type { ConsentHistoryRow, Consents, MarketingResult } from "@/lib/dpdp/types";

import { card, h2, muted, okLine, errorLine } from "../cc/kit";
import { makeT, type Words } from "../words";

/** A day, in India time, the way the person's language writes it ("27 Oct 2026"). */
const day = (iso: string, lang: string): string => new Intl.DateTimeFormat(`${lang}-IN`, { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/**
 * Settings > Privacy and data > "News and offers" (job DQ part 2): the ONE switch that gives and withdraws marketing consent, separate from the account (nothing depends on it). It is off until the person turns it on, turning it off takes
 * effect at once and is never refused, and the person's earlier choices (with the way they were made) are listed under it. A refusal changes nothing and says so. The switch keeps no state of its own beyond what the API answered.
 */
export function MarketingSwitch({ words, lang, initial, action, canEdit = true }: { words: Words; lang: string; initial: Consents; action: (given: boolean) => Promise<MarketingResult>; canEdit?: boolean }) {
  const t = makeT(words);
  const [consents, setConsents] = useState<Consents>(initial);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const on = consents.marketing.state === "given";
  const state = consents.marketing;
  const stateLine = state.state === "not_given" || state.since === null ? t("dpdp.mk.state.not_given") : t(state.state === "given" ? "dpdp.mk.state.given" : "dpdp.mk.state.withdrawn", { date: day(state.since, lang) });
  const flip = () =>
    start(async () => {
      setNote(null);
      try {
        const out = await action(!on);
        if (out.ok) {
          setConsents(out.consents);
          setNote({ ok: true, text: t(!on ? "dpdp.mk.on" : "dpdp.mk.off") });
        } else setNote({ ok: false, text: t("dpdp.mk.err") });
      } catch {
        setNote({ ok: false, text: t("dpdp.mk.err") });
      }
    });
  const rows: ConsentHistoryRow[] = consents.history.slice(0, 5);
  return (
    <section className={card} aria-labelledby="dpdp-mk-h" data-privacy="marketing">
      <h2 id="dpdp-mk-h" className={h2}>
        {t("dpdp.mk.title")}
      </h2>
      <p className={muted}>{t("dpdp.mk.intro")}</p>
      <button type="button" role="switch" aria-checked={on} disabled={pending || !canEdit} onClick={flip} data-write className="mt-3 inline-flex min-h-12 items-center gap-3 rounded-lg pr-2 text-base font-medium disabled:opacity-60">
        <span aria-hidden="true" className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border ${on ? "border-brand-edge bg-brand" : "border-edge bg-surface-2"}`}>
          <span className={`absolute size-5 rounded-full bg-on-brand shadow ${on ? "left-6" : "left-1 bg-muted"}`} />
        </span>
        {t("dpdp.mk.label")}
      </button>
      <p className="mt-1 text-sm text-muted" data-privacy="marketing-state">
        {stateLine}
      </p>
      {note ? (
        <p role="status" className={note.ok ? okLine : errorLine}>
          {note.text}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">{t("dpdp.mk.history")}</h3>
          <ul className="mt-1 text-sm text-muted">
            {rows.map((r) => (
              <li key={`${r.at}-${r.action}`}>
                {day(r.at, lang)}: {t(r.action === "given" ? "dpdp.mk.hist.given" : "dpdp.mk.hist.withdrawn")} ({t(`dpdp.mk.via.${r.via}`) === `dpdp.mk.via.${r.via}` ? r.via : t(`dpdp.mk.via.${r.via}`)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
