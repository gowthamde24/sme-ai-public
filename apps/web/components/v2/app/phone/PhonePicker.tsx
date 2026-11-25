"use client";

import { Check } from "lucide-react";
import * as React from "react";

import { COMPANIES, NUMBER_TYPES, forwardCode, isPrefix, type ClaimResult, type Company, type NumberType, type OwnNumber, type PickNumber, type Refusal, type SearchResult } from "@/lib/phone-picker/types";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import { KycPendingNotice } from "./KycPendingNotice";

/**
 * The number picker (owner, 28 Nov 2026; mock "Phone numbers"): three plain steps on the page, no card, hairlines between them. 1 Pick your number (the type, "starts with", Search, the numbers as radio rows, ONE orange
 * "Use this number"); 2 "It is ready in a minute" (no document for a normal business number); 3 "Keep your shop number too" (the forwarding code for the phone company). A number is always `+91 XXXXX XXXXX`; there is never a price
 * here. A refusal is one plain sentence under the list. The server decides; the screen only explains.
 */
export type PickerActions = { search: (type: NumberType, prefix: string, page: number) => Promise<SearchResult>; claim: (number: string, type: NumberType) => Promise<ClaimResult>; poll: () => Promise<OwnNumber | null> };

const ERR: Record<Refusal["error"], string> = { invalid: "pick.err.prefix", forbidden: "pick.err.forbidden", step_up: "pick.err.stepup", taken: "pick.err.taken", unavailable: "pick.err.now", down: "pick.err.down" };

function Step({ n, title, state, children }: { n: number; title: string; state: "now" | "done" | "off"; children?: React.ReactNode }) {
  return (
    <li data-step={n} data-state-of={state} className="flex gap-4 border-b border-line py-5 first:border-t first:border-t-ink">
      <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full border text-sm font-bold ${state === "now" ? "border-ink bg-ink text-surface" : state === "done" ? "border-ink text-ink" : "border-muted text-muted"}`}>
        {state === "done" ? <Check className="size-4" strokeWidth={2.4} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={`m-0 text-[18px] leading-snug ${state === "off" ? "font-semibold text-muted" : "font-bold text-ink"}`}>{title}</h2>
        {children}
      </div>
    </li>
  );
}

export function PhonePicker({ words, actions, own, canEdit, mock = false, verifyHref }: { words: Words; actions: PickerActions; own: OwnNumber | null; canEdit: boolean; mock?: boolean; verifyHref?: string }) {
  const t = makeT(words);
  const [type, setType] = React.useState<NumberType>("mobile");
  const [prefix, setPrefix] = React.useState("");
  const [rows, setRows] = React.useState<PickNumber[] | null>(null);
  const [more, setMore] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [shown, setShown] = React.useState(6); // six at a time: the server sends 20 a page, the list is not a wall
  const [picked, setPicked] = React.useState<string | null>(null);
  const [fail, setFail] = React.useState<Refusal | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mine, setMine] = React.useState<OwnNumber | null>(own);
  const [company, setCompany] = React.useState<Company>("airtel");

  // after a claim the number is "getting ready", and not active until the business is verified: ask again every 3 seconds (every 10 while it waits for the verification, which the worker marks within minutes)
  React.useEffect(() => {
    if (!mine || (mine.state !== "getting_ready" && mine.state !== "kyc_pending")) return;
    const id = setInterval(() => void actions.poll().then((n) => n && setMine(n)), mine.state === "kyc_pending" ? 10_000 : 3000);
    return () => clearInterval(id);
  }, [mine, actions]);

  const look = async (nextPage: number) => {
    if (!isPrefix(prefix)) {
      setFail({ ok: false, error: "invalid" });
      return;
    }
    setBusy(true);
    setFail(null);
    const r = await actions.search(type, prefix, nextPage);
    setBusy(false);
    if (!r.ok) {
      setFail(r);
      return;
    }
    setRows((cur) => (nextPage > 1 && cur ? [...cur, ...r.numbers] : r.numbers));
    if (nextPage === 1) setShown(6);
    setMore(r.more);
    setPage(r.page);
    if (nextPage === 1) setPicked(r.numbers[0]?.number ?? null);
  };
  const use = async () => {
    if (!picked) return;
    setBusy(true);
    setFail(null);
    const r = await actions.claim(picked, type);
    setBusy(false);
    if (!r.ok) {
      if (r.error === "taken") await look(1); // the list again, then the sentence under it
      setFail(r);
      return;
    }
    setMine(r.number);
  };

  const sentence = (f: Refusal): string => (f.error === "unavailable" && f.reason && f.reason !== "wallet_low" && f.reason !== "daily_limit" ? t(`pick.why.${f.reason}` as "pick.why.paused") : t(ERR[f.error] as "pick.err.down"));
  const code = mine ? forwardCode(company, mine.number) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-3" data-part="phone-picker">
      {mock ? (
        <p className="m-0 text-sm text-muted" data-part="picker-test">
          {t("pick.test")}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col p-0">
        <Step n={1} title={mine ? t("pick.mine") : t("pick.s1.title")} state={mine ? "done" : "now"}>
          {mine ? (
            <>
              <p className="m-0 mt-1 text-[22px] font-semibold tabular-nums text-ink" data-part="my-number">
                {mine.display}
              </p>
              <p className="m-0 mt-1 text-[15px] text-muted" data-part="my-type">
                {t(`pick.type.short.${mine.type}` as "pick.type.short.mobile")}
              </p>
            </>
          ) : (
            <>
              <p className="m-0 mt-1 text-[15px] text-muted">{t("pick.s1.body")}</p>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="pick-type" className={fieldLabel}>
                    {t("pick.type")}
                  </label>
                  <select id="pick-type" value={type} disabled={busy} onChange={(e) => setType(e.target.value as NumberType)} className={`${fieldInput} w-auto`}>
                    {NUMBER_TYPES.map((x) => (
                      <option key={x} value={x}>
                        {t(`pick.type.${x}` as "pick.type.mobile")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="pick-prefix" className={fieldLabel}>
                    {t("pick.prefix")}
                  </label>
                  <input id="pick-prefix" inputMode="numeric" maxLength={6} value={prefix} disabled={busy} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))} className={`${fieldInput} w-40`} />
                </div>
                <button type="button" disabled={busy} onClick={() => void look(1)} className={btnQuiet}>
                  {t("pick.search")}
                </button>
              </div>
              {rows !== null && rows.length > 0 ? (
                <fieldset className="m-0 mt-4 border-0 p-0" data-part="number-list">
                  <legend className="sr-only">{t("pick.list")}</legend>
                  <div className="flex flex-col">
                    {rows.slice(0, shown).map((n) => (
                      <label key={n.number} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line py-2 first:border-t">
                        <input type="radio" name="pick-number" value={n.number} checked={picked === n.number} onChange={() => setPicked(n.number)} className="size-5 accent-ink" />
                        <b className="text-[17px] font-semibold tabular-nums text-ink">{n.display}</b>
                        <small className="text-sm text-muted">{t(`pick.type.short.${n.type}` as "pick.type.short.mobile")}</small>
                      </label>
                    ))}
                  </div>
                  {more || shown < rows.length ? (
                    <button type="button" disabled={busy} onClick={() => (shown < rows.length ? setShown(shown + 6) : void look(page + 1))} className="mt-2 text-sm text-muted underline underline-offset-4">
                      {t("pick.more")}
                    </button>
                  ) : null}
                </fieldset>
              ) : rows !== null && !fail ? (
                <p className="m-0 mt-4 text-[15px] text-muted" data-part="none">
                  {t("pick.none")}
                </p>
              ) : null}
              {fail ? (
                <p role="alert" className="m-0 mt-3 text-[15px] text-ink" data-part="pick-error" data-error={fail.error}>
                  {sentence(fail)}
                </p>
              ) : null}
              {canEdit ? (
                <div className="mt-4">
                  <button type="button" disabled={busy || !picked} onClick={() => void use()} className={btnMain}>
                    {t("pick.use")}
                  </button>
                </div>
              ) : (
                <p className="m-0 mt-4 text-sm text-muted">{t("pick.err.forbidden")}</p>
              )}
            </>
          )}
        </Step>
        <Step n={2} title={t("pick.s2.title")} state={!mine ? "off" : mine.state === "getting_ready" ? "now" : "done"}>
          <p className="m-0 mt-1 text-[15px] text-muted" data-part="ready-line">
            {!mine ? t("pick.s2.body") : mine.state === "getting_ready" ? t("pick.s2.getting", { number: mine.display }) : t("pick.s2.ready", { number: mine.display })}
          </p>
        </Step>
        <Step n={3} title={t("pick.s3.title")} state={mine && mine.state !== "getting_ready" && mine.state !== "kyc_pending" ? "now" : "off"}>
          {mine?.state === "kyc_pending" && verifyHref ? <KycPendingNotice words={words} verifyHref={verifyHref} /> : null}
          <p className="m-0 mt-1 text-[15px] text-muted">{t("pick.s3.body")}</p>
          {mine && mine.state !== "getting_ready" && mine.state !== "kyc_pending" ? (
            <div className="mt-4 flex flex-col gap-3" data-part="forwarding">
              <div className="flex flex-col gap-1">
                <label htmlFor="pick-company" className={fieldLabel}>
                  {t("pick.s3.company")}
                </label>
                <select id="pick-company" value={company} onChange={(e) => setCompany(e.target.value as Company)} className={`${fieldInput} w-auto`}>
                  {COMPANIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`pick.co.${c}` as "pick.co.airtel")}
                    </option>
                  ))}
                </select>
              </div>
              {code ? (
                <>
                  <p className="m-0 text-[15px] text-ink">{t("pick.s3.code")}</p>
                  <p className="m-0 font-mono text-[17px] tabular-nums text-ink" data-part="code-on">
                    {code.on}
                  </p>
                  <p className="m-0 text-sm text-muted">
                    {t("pick.s3.off")} <span className="font-mono">{code.off}</span>
                  </p>
                </>
              ) : (
                <p className="m-0 text-[15px] text-ink" data-part="code-none">
                  {t("pick.s3.nocode")}
                </p>
              )}
            </div>
          ) : null}
        </Step>
      </ol>
    </div>
  );
}
