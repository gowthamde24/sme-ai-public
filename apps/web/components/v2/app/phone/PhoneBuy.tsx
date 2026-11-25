"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { AccountType, KycStatus } from "@/lib/api/business-kyc";
import { NUMBER_TYPES, isPrefix, type NumberType, type PickNumber, type SearchResult } from "@/lib/phone-picker/types";

import { Tick } from "../ds/Tick";
import { btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import { KycInline, type VerifyActions } from "./KycFlow";
import { Notice, Seg, Step } from "./steps";
import { PREFILL_KEY, refusalSentence } from "./kyc-shared";

export { PREFILL_KEY, refusalSentence };

/**
 * "Get a phone number" (KYC_PER_CLIENT with PHONE_PICKER; owner 29 Nov 2026; mock "Get a phone number"): four short steps in ONE page, open layout, one step in hand at a time. 1 Choose a number (Mobile | Landline, the first digits, the numbers: never a price);
 * 2 Your calling account (Individual | Business, full name, the e-mail you signed in with: asked once, "You cannot change these later"); 3 Verification (you verify yourself AFTER you buy; PAN and Aadhaar make you, not us, the registered owner; until it is done the
 * number cannot make calls); 4 How you will use this number (a required tick; the last button stays off until it is ticked). Nothing is bought before step 4's button. Every refusal is one plain sentence; the server decides, the screen only explains.
 */
export type BuyInput = { number: string; type: NumberType; accountType: AccountType; agree: true };
export type BuyAnswer = { ok: true; number: { number: string; display: string } } | { ok: false; error: string; reason?: string };
export type BuyActions = { search: (type: NumberType, prefix: string, page: number) => Promise<SearchResult>; buy: (input: BuyInput) => Promise<BuyAnswer> };



/** `kyc` (KYC_PER_CLIENT): the business's verification status and its actions, so step 3 can offer "Verify now" on this page. Without it step 3 only says that you verify after buying. */
export type InlineKyc = { status: KycStatus; actions: VerifyActions };

export function PhoneBuy({ words, actions, canEdit, email, mock = false, verifyHref, kyc = null }: { words: Words; actions: BuyActions; canEdit: boolean; email: string | null; mock?: boolean; verifyHref: string; kyc?: InlineKyc | null }) {
  const t = makeT(words);
  const router = useRouter();
  const [now, setNow] = React.useState(1);
  const [type, setType] = React.useState<NumberType>("mobile");
  const [prefix, setPrefix] = React.useState("");
  const [rows, setRows] = React.useState<PickNumber[] | null>(null);
  const [more, setMore] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [shown, setShown] = React.useState(6);
  const [picked, setPicked] = React.useState<PickNumber | null>(null);
  const [account, setAccount] = React.useState<AccountType>("individual");
  const [name, setName] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<{ error: string; reason?: string } | null>(null);
  const [nameError, setNameError] = React.useState(false);
  const [verifyWhen, setVerifyWhen] = React.useState<"now" | "later">(kyc && canEdit ? "now" : "later");
  const [kycState, setKycState] = React.useState<KycStatus["state"]>(kyc?.status.state ?? "not_started");
  const verified = kycState === "verified";

  const look = React.useCallback(
    async (nextType: NumberType, nextPrefix: string, nextPage: number) => {
      if (!isPrefix(nextPrefix)) {
        setFail({ error: "invalid" });
        return;
      }
      setBusy(true);
      setFail(null);
      const r = await actions.search(nextType, nextPrefix, nextPage);
      setBusy(false);
      if (!r.ok) {
        setFail({ error: r.error, reason: r.reason });
        return;
      }
      setRows((cur) => (nextPage > 1 && cur ? [...cur, ...r.numbers] : r.numbers));
      if (nextPage === 1) {
        setShown(6);
        setPicked((p) => (p && r.numbers.some((n) => n.number === p.number) ? p : null));
      }
      setMore(r.more);
      setPage(r.page);
    },
    [actions],
  );
  // the numbers of the tab are there at once (and again when the tab changes), like the mock
  React.useEffect(() => {
    queueMicrotask(() => void look(type, "", 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function confirm() {
    if (!picked || !agree) return;
    setBusy(true);
    setFail(null);
    const r = await actions.buy({ number: picked.number, type: picked.type, accountType: account, agree: true });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "taken") {
        setNow(1);
        void look(type, prefix, 1);
      }
      setFail({ error: r.error, reason: r.reason });
      return;
    }
    try {
      window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ accountType: account, fullName: name.trim() }));
    } catch {
      // a browser that keeps nothing: the verification page simply starts empty
    }
    router.refresh();
  }

  const state = (n: number) => (now === n ? "now" : now > n ? "done" : "off");
  const error = fail ? (
    <p role="alert" data-part="buy-error" data-error={fail.error} className="m-0 mt-3 text-[15px] text-ink">
      {refusalSentence(t, fail.error, fail.reason)}
      {fail.reason === "kyc_required" ? (
        <>
          {" "}
          <Link href={verifyHref} prefetch={false} data-part="verify-link" className="font-semibold text-ink underline underline-offset-4">
            {t("pick.kyc.title")}
          </Link>
        </>
      ) : null}
    </p>
  ) : null;
  const typeOptions = NUMBER_TYPES.map((x) => ({ value: x, label: t(`pick.type.short.${x}` as "pick.type.short.mobile") }));

  return (
    <div className="flex max-w-3xl flex-col gap-3" data-part="phone-buy">
      {mock ? (
        <p className="m-0 text-sm text-muted" data-part="picker-test">
          {t("pick.test")}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col p-0">
        <Step n={1} title={t("pick.buy.s1.t")} state={state(1)} summary={picked && now > 1 ? <span className="tabular-nums">{picked.display}</span> : undefined}>
          {now === 1 ? (
            <div className="mt-3 flex flex-col gap-4">
              <Seg label={t("pick.type")} value={type} options={typeOptions} disabled={busy} onChange={(v) => setType(v)} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-0 flex-col">
                  <label htmlFor="buy-prefix" className={fieldLabel}>
                    {t("pick.prefix")}
                  </label>
                  <input id="buy-prefix" inputMode="numeric" maxLength={6} value={prefix} disabled={busy} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void look(type, prefix, 1))} className={`${fieldInput} w-44`} />
                </div>
                <button type="button" disabled={busy} onClick={() => void look(type, prefix, 1)} className={btnQuiet}>
                  {t("pick.search")}
                </button>
              </div>
              {rows !== null && rows.length > 0 ? (
                <fieldset className="m-0 border-0 p-0" data-part="number-list">
                  <legend className="sr-only">{t("pick.list")}</legend>
                  <div className="flex flex-col">
                    {rows.slice(0, shown).map((n) => (
                      <label key={n.number} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line py-2 first:border-t first:border-t-ink">
                        <input type="radio" name="buy-number" value={n.number} checked={picked?.number === n.number} onChange={() => setPicked(n)} className="size-5 shrink-0 accent-ink" />
                        <b className="min-w-0 text-[17px] font-semibold tabular-nums text-ink">{n.display}</b>
                        <small className="ml-auto text-sm text-muted">{t(`pick.type.short.${n.type}` as "pick.type.short.mobile")}</small>
                      </label>
                    ))}
                  </div>
                  {more || shown < rows.length ? (
                    <button type="button" disabled={busy} onClick={() => (shown < rows.length ? setShown(shown + 6) : void look(type, prefix, page + 1))} className="mt-2 min-h-11 text-sm text-muted underline underline-offset-4">
                      {t("pick.more")}
                    </button>
                  ) : null}
                </fieldset>
              ) : rows !== null && !fail ? (
                <p className="m-0 text-[15px] text-muted" data-part="none">
                  {t("pick.none")}
                </p>
              ) : null}
              <p className={`${fieldHelp} m-0`}>{t("pick.buy.s1.note")}</p>
              {error}
              <div>
                <button type="button" data-part="use" disabled={busy || !picked} onClick={() => (setFail(null), setNow(2))} className={btnMain}>
                  {t("pick.use")}
                </button>
              </div>
            </div>
          ) : null}
        </Step>
        <Step n={2} title={t("pick.buy.s2.t")} state={state(2)} summary={now > 2 ? `${t(`pick.buy.type.${account}`)} · ${name.trim()}` : undefined}>
          {now === 2 ? (
            <div className="mt-2 flex flex-col gap-4">
              <p className="m-0 text-[15px] text-muted">{t("pick.buy.s2.body")}</p>
              <Seg label={t("pick.buy.type")} value={account} options={[{ value: "individual", label: t("pick.buy.type.individual") }, { value: "business", label: t("pick.buy.type.business") }]} onChange={setAccount} />
              <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
                <div className="flex min-w-0 flex-col">
                  <label htmlFor="buy-name" className={fieldLabel}>
                    {t("pick.buy.name")}
                  </label>
                  <input id="buy-name" type="text" autoComplete="name" maxLength={120} value={name} aria-invalid={nameError || undefined} onChange={(e) => (setName(e.target.value), setNameError(false))} className={fieldInput} />
                  {nameError ? (
                    <p role="alert" className="m-0 mt-1.5 text-sm text-ink">
                      {t("pick.buy.err.name")}
                    </p>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col">
                  <label htmlFor="buy-email" className={fieldLabel}>
                    {t("pick.buy.email")}
                  </label>
                  <input id="buy-email" type="text" inputMode="email" readOnly value={email ?? ""} className={`${fieldInput} text-muted`} />
                </div>
              </div>
              <p className={`${fieldHelp} m-0`}>{t("pick.buy.s2.note")}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  data-part="next-2"
                  onClick={() => (name.trim().length < 2 ? setNameError(true) : setNow(3))}
                  className={btnMain}
                >
                  {t("pick.buy.next")}
                </button>
                <button type="button" onClick={() => setNow(1)} className={btnQuiet}>
                  {t("pick.buy.back")}
                </button>
              </div>
            </div>
          ) : null}
        </Step>
        <Step n={3} title={t("pick.buy.s3.t")} state={state(3)}>
          {now === 3 ? (
            <div className="mt-3 flex flex-col gap-4">
              {kyc ? (
                <fieldset className="m-0 flex flex-col gap-3 border-0 p-0" data-part="verify-choice">
                  <legend className="sr-only">{t("pick.buy.s3.t")}</legend>
                  {(["now", "later"] as const).map((w) => (
                    <label key={w} data-choice={w} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${verifyWhen === w ? "border-ink bg-surface" : "border-line bg-surface"}`}>
                      <input type="radio" name="verify-when" value={w} checked={verifyWhen === w} disabled={w === "now" && !canEdit} onChange={() => setVerifyWhen(w)} className="mt-1 size-5 shrink-0 accent-ink" />
                      <span className="min-w-0">
                        <b className="text-ink">
                          {t(`pick.buy.s3.${w}.t` as "pick.buy.s3.now.t")}
                          {w === "now" ? <span className="ml-2 text-sm font-semibold text-muted">{t("pick.buy.s3.now.tag")}</span> : null}
                        </b>
                        <span className="m-0 mt-1.5 block text-[15px] text-muted">{t(`pick.buy.s3.${w}.d` as "pick.buy.s3.now.d")}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <div className="rounded-2xl border border-line bg-surface p-4" data-part="verify-box">
                  <b className="text-ink">{t("pick.buy.s3.head")}</b>
                  <p className="m-0 mt-1.5 text-[15px] text-muted">{t("pick.buy.s3.body")}</p>
                </div>
              )}
              {kyc && verifyWhen === "now" ? <KycInline t={t} status={kyc.status} actions={kyc.actions} canEdit={canEdit} account={account} fullName={name.trim()} onState={setKycState} /> : null}
              <div className="flex flex-wrap gap-3">
                <button type="button" data-part="next-3" disabled={verifyWhen === "now" && kyc !== null && !verified} onClick={() => setNow(4)} className={btnMain}>
                  {t("pick.buy.next")}
                </button>
                <button type="button" onClick={() => setNow(2)} className={btnQuiet}>
                  {t("pick.buy.back")}
                </button>
              </div>
              {kyc && verifyWhen === "now" && !verified ? <p className={`${fieldHelp} m-0`}>{t("pick.buy.s3.now.wait")}</p> : null}
            </div>
          ) : null}
        </Step>
        <Step n={4} title={t("pick.buy.s4.t")} state={state(4)}>
          {now === 4 ? (
            <div className="mt-2 flex flex-col gap-3">
              <div className="border-t border-ink">
                <Tick id="buy-agree" name="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} required aria-required="true" label={t("pick.buy.s4.ack")} />
              </div>
              {error}
              {canEdit ? (
                <div className="flex flex-wrap gap-3">
                  <button type="button" data-part="confirm" disabled={busy || !agree} onClick={() => void confirm()} className={btnMain}>
                    {busy ? t("pick.buy.getting") : t("pick.buy.confirm")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setNow(3)} className={btnQuiet}>
                    {t("pick.buy.back")}
                  </button>
                </div>
              ) : (
                <Notice>{t("pick.err.forbidden")}</Notice>
              )}
            </div>
          ) : null}
        </Step>
      </ol>
    </div>
  );
}
