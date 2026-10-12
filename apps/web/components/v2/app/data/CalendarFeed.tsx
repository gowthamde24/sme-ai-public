"use client";

import { useId, useState } from "react";

import type { CalendarFeed as Feed, NewCalendarFeed } from "@/lib/api/data";
import { FailureNote } from "../cc/FailureNote";
import { card, h3, help, monoBox, okLine, primary, quiet, secondary, type Failed } from "../cc/kit";
import { LocalTime } from "@/app/app/local-time";
import { makeT, type Words } from "../words";

type Result = { ok: true; feed: NewCalendarFeed } | Failed;
type Revoked = { ok: true } | Failed;

/**
 * Settings > Data > the calendar address (job CC): a private web address that a phone's calendar app subscribes to, to see upcoming store visits. The address is shown ONCE, when it is made (the API keeps only a hash of
 * it); a new one stops the old one. Any member can make their own. The address is never put in the page's address or stored by the browser: it lives in this component's memory until the person leaves.
 */
export function CalendarFeed({ words, feed, make, revoke }: { words: Words; feed: Feed; make: () => Promise<Result>; revoke: () => Promise<Revoked> }) {
  const t = makeT(words);
  const id = useId();
  const [state, setState] = useState<Feed>(feed);
  const [fresh, setFresh] = useState<NewCalendarFeed | null>(null);
  const [busy, setBusy] = useState<"make" | "revoke" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const [revoked, setRevoked] = useState(false);

  async function onMake() {
    setBusy("make");
    setFailure(null);
    setRevoked(false);
    setCopied(null);
    const r = await make();
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setFresh(r.feed);
    setState({ active: true, created_at: r.feed.created_at, last_used_at: null });
  }
  async function onRevoke() {
    setBusy("revoke");
    setFailure(null);
    const r = await revoke();
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setFresh(null);
    setState({ active: false, created_at: null, last_used_at: null });
    setRevoked(true);
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  }

  return (
    <section className={card} aria-labelledby={`${id}-h`} data-data="calendar">
      <h2 id={`${id}-h`} className="font-display text-xl font-bold leading-tight">
        {t("dta.cal.title")}
      </h2>
      <p className="text-base text-muted">{t("dta.cal.intro")}</p>
      <p className={help}>{t("dta.cal.mine")}</p>

      {state.active ? (
        <div className="text-base">
          <p>{t("dta.cal.on")}</p>
          {state.created_at ? (
            <p className="text-muted">
              {t("dta.cal.made")} <LocalTime iso={state.created_at} />
            </p>
          ) : null}
          <p className="text-muted">
            {state.last_used_at ? (
              <>
                {t("dta.cal.used")} <LocalTime iso={state.last_used_at} />
              </>
            ) : (
              t("dta.cal.never")
            )}
          </p>
        </div>
      ) : (
        <p className="text-base">{revoked ? t("dta.cal.revoked") : t("dta.cal.off")}</p>
      )}

      {fresh ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-text bg-amber-bg p-4">
          <h3 className={h3}>{t("dta.cal.shown_title")}</h3>
          <p className="text-base font-medium text-amber-text">{t("dta.cal.shown_once")}</p>
          <p className={help}>{t("dta.cal.address")}</p>
          <p className={monoBox} data-calendar-address="">
            {fresh.url}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => copy(fresh.url)} className={secondary}>
              {copied === "yes" ? t("dta.btn.copied") : t("dta.btn.copy")}
            </button>
            <a href={fresh.webcal} className="inline-flex min-h-11 items-center rounded-full px-2 text-base font-semibold text-brand-text underline">
              {t("dta.cal.phone")}
            </a>
          </div>
          {copied === "yes" ? (
            <p role="status" className={okLine}>
              {t("dta.btn.copied")}
            </p>
          ) : null}
          {copied === "no" ? (
            <p role="alert" className="text-sm font-medium text-red-text">
              {t("dta.cal.copy_failed")}
            </p>
          ) : null}
          <p className={help}>{t("dta.cal.how")}</p>
        </div>
      ) : null}

      <FailureNote failure={failure} words={words} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onMake} disabled={busy !== null} className={primary}>
          {busy === "make" ? t("dta.btn.working") : state.active ? t("dta.btn.cal_new") : t("dta.btn.cal_make")}
        </button>
        {state.active ? (
          <button type="button" onClick={onRevoke} disabled={busy !== null} className={quiet}>
            {busy === "revoke" ? t("dta.btn.working") : t("dta.btn.cal_revoke")}
          </button>
        ) : null}
      </div>
      {state.active ? <p className={help}>{t("dta.cal.new_hint")}</p> : null}
    </section>
  );
}
