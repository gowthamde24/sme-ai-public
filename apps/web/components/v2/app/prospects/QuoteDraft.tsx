"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { draftQuoteHref, rupees, type QuoteDraftMade, type QuoteDraftView } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { muted, okLine, pillClass, primary, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";

export type DraftActions = { preview: () => Promise<Reply<QuoteDraftView>>; make: () => Promise<Reply<QuoteDraftMade>> };

const unavailable: Failed = { ok: false, kind: "unavailable", error: "" };
async function ask<T>(step: () => Promise<Reply<T>>): Promise<Reply<T>> {
  try {
    return await step();
  } catch {
    return unavailable;
  }
}

/**
 * The draft quote of a QUALIFIED call (contract section 7): on a qualified business of the Prospects list, and under a practice call that qualified. Opening it reads the PREVIEW (nothing is stored): each line "item × qty at ₹price"
 * with what the buyer said, and each suggestion left out with its reason in words. "Make the draft quote" (the Owner or an Admin, only when a line can go in) makes ONE enquiry on the call's lead and ONE draft quote at the Owner's own
 * catalogue prices; a missing second factor shows the way to Security. Once made (or when it already was): "Open the draft quote", on its ENQUIRY's page. Nothing here approves or sends anything.
 */
export function QuoteDraft({ words, base, canMake, actions, open = false }: { words: Words; base: string; canMake: boolean; actions: DraftActions; /** Opened at once (after a practice call that qualified), else when the person opens it. */ open?: boolean }) {
  const t = makeT(words);
  const [view, setView] = useState<QuoteDraftView | null>(null);
  const [made, setMade] = useState<QuoteDraftMade | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const asked = useRef(false);

  async function load() {
    asked.current = true;
    setBusy(true);
    const r = await ask(actions.preview);
    setBusy(false);
    if (r.ok) setView(r.data);
    else setFailure(r);
  }
  useEffect(() => {
    if (open && !asked.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it is drawn open
  }, []);
  async function makeIt() {
    setBusy(true);
    setFailure(null);
    const r = await ask(actions.make);
    setBusy(false);
    if (r.ok) return setMade(r.data);
    setFailure(r);
    // made before with other prices: the preview says so now, with the way to open it
    if (r.code === "quote_draft_exists") {
      const again = await ask(actions.preview);
      if (again.ok) setView(again.data);
    }
  }

  const lines = made?.lines ?? view?.lines ?? [];
  const leftOut = made?.leftOut ?? view?.leftOut ?? [];
  const href = made ? draftQuoteHref(base, made.enquiryId, made.quoteId) : view?.made ? (view.enquiryId ? draftQuoteHref(base, view.enquiryId, view.quoteId) : `${base}/quotes`) : null;
  return (
    <details
      className="rounded-2xl bg-surface-2 px-3 py-1 sm:px-4"
      data-quote-draft-box=""
      open={open}
      onToggle={(e) => {
        if (e.currentTarget.open && !asked.current) void load();
      }}
    >
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-brand-text">{t("lf.qd.open")}</summary>
      <div className="flex flex-col gap-3 pb-3">
        {busy && !view && !made ? (
          <p className={muted} aria-live="polite">
            {t("lf.working")}
          </p>
        ) : null}
        {view || made ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted">
              {t("lf.pc.quote")} <span className={pillClass("amber")}>{t("today.state.draft")}</span>
            </p>
            {lines.length > 0 ? (
              <ul className="flex flex-col gap-1.5" data-draft-lines="">
                {lines.map((l, i) => (
                  <li key={`${l.itemTypeCode}-${i}`} className="[overflow-wrap:anywhere]">
                    <span className="font-semibold tabular-nums">{t("lf.qd.line", { item: l.item, qty: l.qty, price: rupees(l.unitPricePaise) })}</span>
                    {l.quantitySaid ? <span className="block text-sm text-muted">{t("lf.pc.said", { text: l.quantitySaid })}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {leftOut.length > 0 ? (
              <div data-draft-left-out="">
                <p className="text-sm font-semibold text-muted">{t("lf.qd.left")}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {leftOut.map((l, i) => (
                    <li key={`${l.item}-${i}`} className="[overflow-wrap:anywhere]">
                      {l.item} · <span className="text-muted">{t(`lf.qd.reason.${l.reason}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {made ? (
              <p role="status" className={okLine} data-draft-made="">
                {t("lf.qd.made")}
              </p>
            ) : null}
            {href ? (
              <Link href={href} className={`${primary} !whitespace-normal self-start text-center`} data-draft-open="">
                {t("lf.qd.open_quote")}
              </Link>
            ) : view?.ready ? (
              canMake ? (
                <button type="button" disabled={busy} onClick={() => void makeIt()} className={`${primary} write-ctl !whitespace-normal self-start text-center`} data-draft-make="">
                  {busy ? t("lf.working") : t("lf.qd.make")}
                </button>
              ) : (
                <p className={muted}>{t("lf.qd.owner")}</p>
              )
            ) : (
              <p className={muted}>{t("lf.qd.none")}</p>
            )}
            <p className={muted}>{t("lf.qd.note")}</p>
          </>
        ) : null}
        <FailureNote failure={failure} words={words} />
      </div>
    </details>
  );
}
