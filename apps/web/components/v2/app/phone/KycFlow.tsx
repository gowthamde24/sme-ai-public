"use client";

import Link from "next/link";
import * as React from "react";

import type { AccountType, DocType, KycStatus } from "@/lib/api/business-kyc";
import type { KycResult } from "@/lib/phone-kyc/source";

import { Tick } from "../ds/Tick";
import { btnMain, btnQuiet, fieldHelp, fieldInput } from "../ui";
import type { Say } from "../words";
import { formatRupeesShort } from "@/lib/money";
import { EXTRA_NUMBER_PAISE } from "@/lib/plan/plans-v2";
import { refusalSentence } from "./kyc-shared";
import { FieldError, RequiredField, describedBy } from "./kyc-field";
import { API_FIELD, INDIAN_STATES, detailsProblems, fileProblem, gstProblem, holderProblem, panProblem, reasonProblem, type DetailsInput, type Problem } from "@/lib/phone-kyc/rules";

export type VerifyActions = {
  status: () => Promise<KycStatus | null>;
  start: (type: AccountType) => Promise<KycResult>;
  details: (input: Record<string, unknown>) => Promise<KycResult>;
  pan: (panNumber: string, holderName: string) => Promise<KycResult>;
  gst: (gstNumber: string) => Promise<KycResult>;
  aadhaar: () => Promise<KycResult<{ url: string }>>;
  submit: () => Promise<KycResult>;
  /** the state and the city of a complete PIN code (the form fills them in); absent or null = the person types them */
  /** "Stop and get my credits back" (the held first month is refunded and the unverified account is deleted); absent = no such button */
  cancel?: () => Promise<KycResult>;
  /** where the credits are added (the Billing page) */
  creditsHref?: string;
  pin?: (pin: string) => Promise<{ state: string | null; city: string | null } | null>;
  /** the address that takes one document (multipart `type` + `file`); answers the same words as the actions */
  uploadUrl: string;
};
export type Fail = { error: string; reason?: string; missing?: string[]; fieldReasons?: Record<string, string>; needed?: string };
const DOCS: Record<AccountType, readonly DocType[]> = { individual: ["pan", "aadhaar"], business: ["pan", "aadhaar", "gst"] };
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "application/pdf"];


export type FlowProps = {
  /** a status read while a link is open (DigiLocker): the page takes it as the new status */
  refresh?: (s: KycStatus) => void; t: Say; status: KycStatus; actions: VerifyActions; prefill: { accountType?: AccountType; fullName?: string } | null; busy: boolean; run: (go: () => Promise<KycResult>) => Promise<KycStatus | null>; fail: Fail | null; setFail: (f: Fail | null) => void };

/** The real steps, one in hand at a time: the details, then each document (PAN, Aadhaar, and for a business the GST), then "Send for checking". */
export function Flow({ t, status, actions, prefill, busy, run, fail, setFail, refresh }: FlowProps) {
  const account: AccountType = status.accountType ?? prefill?.accountType ?? "individual";
  const needs = DOCS[account];
  const details = status.state === "created";
  // Aadhaar is done once the DigiLocker check reached the phone service (`aadhaar_verified`), or its document is in
  const isDone = (d: DocType): boolean => status.steps[d] === true || (d === "aadhaar" && status.aadhaarVerified === true);
  const next = needs.find((d) => !isDone(d)) ?? null;
  const problem = fail ? (
    <div role="alert" data-part="verify-error" data-error={fail.error}>
      {fail.fieldReasons && !details ? (
        [...new Set(Object.values(fail.fieldReasons).map((w) => problemText(t, reasonProblem(w))))].map((x) => <p key={x} className="m-0 text-[15px] text-ink">{x}</p>)
      ) : fail.fieldReasons ? null : (
        <p className="m-0 text-[15px] text-ink">{refusalSentence(t, fail.error, fail.reason)}</p>
      )}
      {fail.missing && fail.missing.length > 0 ? <p className="m-0 mt-1 text-[15px] text-ink">{t("pick.kyc.missing", { list: fail.missing.join(", ") })}</p> : null}
    </div>
  ) : null;
  return (
    <div className="mt-4 flex flex-col gap-5" data-part="verify-flow">
      {details ? <Details t={t} account={account} prefill={prefill} busy={busy} server={fail?.fieldReasons ?? null} lookup={actions.pin} onSave={(input) => void run(() => actions.details(input))} /> : null}
      {!details ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {needs.map((d) => {
            const done = isDone(d);
            return (
              <li key={d} data-doc={d} data-done={done ? "" : undefined} className="flex flex-col gap-3 border-b border-line py-4 first:border-t first:border-t-ink">
                <div className="flex items-center justify-between gap-3">
                  <b className="text-base text-ink">{t(`pick.kyc.doc.${d}`)}</b>
                  <span className="text-sm text-muted">{done ? t("pick.kyc.uploaded") : d === next ? t("pick.kyc.chip.waiting") : ""}</span>
                </div>
                {d === next ? <DocStep t={t} doc={d} prefill={prefill} actions={actions} busy={busy} run={run} setFail={setFail} refresh={refresh} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {problem}
      {!details && next === null ? (
        <div>
          <button type="button" data-part="submit" disabled={busy} onClick={() => void run(actions.submit)} className={btnMain}>
            {t("pick.kyc.submit")}
          </button>
        </div>
      ) : null}
      <p className={`${fieldHelp} m-0`}>{t("pick.kyc.kept")}</p>
    </div>
  );
}

const problemText = (t: Say, p: Problem | null | undefined): string | null => (p ? t(`pick.kyc.e.${p}` as "pick.kyc.e.required") : null);

/** The details of the business's account. Every field is mandatory (owner, 26 Nov 2026): "Required" beside each label, a plain sentence under a field once it was touched or the form was sent, "Save and continue" off until all is valid; what was typed stays when a message shows. */
function Details({ t, account, prefill, busy, server, lookup, onSave }: { t: Say; account: AccountType; prefill: FlowProps["prefill"]; busy: boolean; server: Record<string, string> | null; lookup?: VerifyActions["pin"]; onSave: (input: Record<string, unknown>) => void }) {
  const [v, setV] = React.useState<DetailsInput>({ businessName: "", fullName: prefill?.fullName ?? "", phone: "", billingAddress: "", city: "", state: "", pincode: "", terms: false });
  const [touched, setTouched] = React.useState<Partial<Record<keyof DetailsInput, boolean>>>({});
  const [sent, setSent] = React.useState(false);
  // a complete PIN fills the state and the city (the person can correct them; a field the person typed in is never overwritten)
  const typed = React.useRef<{ state?: boolean; city?: boolean }>({});
  const [pinNote, setPinNote] = React.useState<"looking" | "filled" | null>(null);
  const pinAsked = React.useRef(0);
  // asked when the 6th digit is typed (not in an effect); an older answer that arrives late is dropped
  const onPin = (value: string) => {
    const mine = ++pinAsked.current;
    if (!lookup || !/^[1-9][0-9]{5}$/.test(value)) return setPinNote(null);
    setPinNote("looking");
    void lookup(value).then((found) => {
      if (mine !== pinAsked.current) return;
      if (!found) return setPinNote(null);
      setV((x) => ({ ...x, state: typed.current.state || !found.state ? x.state : found.state, city: typed.current.city || !found.city ? x.city : found.city }));
      setPinNote(found.state || found.city ? "filled" : null);
    });
  };
  const problems = detailsProblems(v, account === "business");
  const valid = Object.keys(problems).length === 0;
  // the API's own word for a bad field (a `422 kyc_fields_invalid`) is said with the same sentence as the screen's check, until that field is changed
  const [edited, setEdited] = React.useState<Partial<Record<keyof DetailsInput, boolean>>>({});
  const fromServer = (k: keyof DetailsInput): string | null => {
    const word = server ? Object.entries(server).find(([field]) => API_FIELD[field] === k)?.[1] : undefined;
    return word && !edited[k] ? problemText(t, reasonProblem(word)) : null;
  };
  const shown = (k: keyof DetailsInput): string | null => (touched[k] || sent ? problemText(t, problems[k]) : null) ?? fromServer(k);
  const set = (k: keyof DetailsInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => (setEdited((x) => ({ ...x, [k]: true })), setV((x) => ({ ...x, [k]: e.target.value })));
  const touch = (k: keyof DetailsInput) => () => setTouched((x) => ({ ...x, [k]: true }));
  const ctl = (k: keyof DetailsInput, id: string) => ({ id, required: true, "aria-required": true as const, "aria-invalid": shown(k) ? true : undefined, "aria-describedby": describedBy(id, shown(k)), onBlur: touch(k), className: fieldInput });
  return (
    <form
      data-part="details"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
        if (!valid) return;
        setEdited({}); // a word the API sends back now is about THIS save; it goes away when that field is changed
        onSave({ accountType: account, businessName: v.businessName.trim(), fullName: v.fullName.trim(), phone: v.phone.trim(), billingAddress: v.billingAddress.trim(), city: v.city.trim(), state: v.state, pincode: v.pincode.trim(), acceptTerms: v.terms });
      }}
    >
      {account === "business" ? (
        <RequiredField t={t} id="kyc-biz" label={t("pick.kyc.f.business")} error={shown("businessName")}>
          <input {...ctl("businessName", "kyc-biz")} type="text" maxLength={120} value={v.businessName} onChange={set("businessName")} />
        </RequiredField>
      ) : null}
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
        <RequiredField t={t} id="kyc-name" label={t("pick.buy.name")} error={shown("fullName")}>
          <input {...ctl("fullName", "kyc-name")} type="text" autoComplete="name" maxLength={120} value={v.fullName} onChange={set("fullName")} />
        </RequiredField>
        <RequiredField t={t} id="kyc-phone" label={t("pick.kyc.f.phone")} hint={t("pick.kyc.f.phone.hint")} error={shown("phone")}>
          <input {...ctl("phone", "kyc-phone")} type="tel" autoComplete="tel" inputMode="tel" maxLength={18} value={v.phone} onChange={set("phone")} />
        </RequiredField>
      </div>
      <RequiredField t={t} id="kyc-addr" label={t("pick.kyc.f.address")} error={shown("billingAddress")}>
        <input {...ctl("billingAddress", "kyc-addr")} type="text" autoComplete="street-address" maxLength={300} value={v.billingAddress} onChange={set("billingAddress")} />
      </RequiredField>
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-3">
        <RequiredField t={t} id="kyc-city" label={t("pick.kyc.f.city")} error={shown("city")}>
          <input {...ctl("city", "kyc-city")} type="text" autoComplete="address-level2" maxLength={60} value={v.city} onChange={(e) => ((typed.current.city = true), set("city")(e))} />
        </RequiredField>
        <RequiredField t={t} id="kyc-state" label={t("pick.kyc.f.state")} error={shown("state")}>
          <select {...ctl("state", "kyc-state")} autoComplete="address-level1" value={v.state} onChange={(e) => ((typed.current.state = true), set("state")(e))}>
            <option value="">{t("pick.kyc.f.state.choose")}</option>
            {INDIAN_STATES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </RequiredField>
        <RequiredField t={t} id="kyc-pin" label={t("pick.kyc.f.pin")} hint={pinNote === "looking" ? t("pick.kyc.pin.looking") : pinNote === "filled" ? t("pick.kyc.pin.filled") : undefined} error={shown("pincode")}>
          <input {...ctl("pincode", "kyc-pin")} type="text" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={v.pincode} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEdited((x) => ({ ...x, pincode: true })); setV((x) => ({ ...x, pincode: digits })); onPin(digits); }} />
        </RequiredField>
      </div>
      <div className="border-t border-ink">
        <Tick id="kyc-terms" checked={v.terms} required aria-required="true" onChange={(e) => (setV((x) => ({ ...x, terms: e.target.checked })), touch("terms")())} label={`${t("pick.kyc.f.terms")} (${t("pick.kyc.req")})`} />
        {shown("terms") ? <FieldError id="kyc-terms-err" text={shown("terms") as string} /> : null}
      </div>
      <div>
        <button type="submit" data-part="save-details" disabled={busy || !valid} className={btnMain}>
          {t("pick.kyc.save")}
        </button>
      </div>
    </form>
  );
}

function DocStep({ t, doc, prefill, actions, busy, run, setFail, refresh }: { t: Say; doc: DocType; prefill: FlowProps["prefill"]; actions: VerifyActions; busy: boolean; run: FlowProps["run"]; setFail: FlowProps["setFail"]; refresh?: FlowProps["refresh"] }) {
  const [number, setNumber] = React.useState("");
  const [holder, setHolder] = React.useState(prefill?.fullName ?? "");
  const [link, setLink] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [sending, setSending] = React.useState(false);
  // Aadhaar (DigiLocker): the result reaches the phone service only if the redirect after "Allow" completes, so the person is told to stay, the status is read every 7 seconds while the link is open, and when the person is back (or about 2 minutes passed) and it is still not done the check can be started again (a new link; nothing is lost or charged)
  const [openedAt, setOpenedAt] = React.useState<number | null>(null);
  const [back, setBack] = React.useState(false);
  const [waited, setWaited] = React.useState(false);
  const [seen, setSeen] = React.useState<{ number?: boolean; holder?: boolean; file?: boolean }>({});
  const numberProblem = doc === "gst" ? gstProblem(number) : doc === "pan" ? panProblem(number) : null;
  const holderBad = doc === "pan" ? holderProblem(holder) : null;
  const fileBad = fileProblem(file);

  React.useEffect(() => {
    if (doc !== "aadhaar" || openedAt === null) return;
    const poll = setInterval(() => void actions.status().then((s) => (s ? refresh?.(s) : undefined)), 7000);
    const wait = setTimeout(() => setWaited(true), 120_000);
    const visible = () => document.visibilityState === "visible" && setBack(true);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(poll);
      clearTimeout(wait);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [doc, openedAt, actions, refresh]);

  async function upload(): Promise<KycStatus | null> {
    if (!file) return null;
    if (file.size > MAX_BYTES) return (setFail({ error: "refused", reason: "file_too_big" }), null);
    if (!TYPES.includes(file.type)) return (setFail({ error: "refused", reason: "file_unreadable" }), null);
    return run(async () => {
      const form = new FormData();
      form.set("type", doc);
      form.set("file", file);
      try {
        const res = await fetch(actions.uploadUrl, { method: "POST", body: form, credentials: "same-origin", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as KycResult | null;
        return json && typeof json === "object" && "ok" in json ? json : { ok: false, error: "down" };
      } catch {
        return { ok: false, error: "down" };
      }
    });
  }
  async function send() {
    setSending(true);
    setFail(null);
    // PAN and GST: the number is checked first, then the file goes; Aadhaar: the file goes once the link was opened
    if (doc === "pan") {
      if ((await run(() => actions.pan(number, holder))) === null) return setSending(false);
    } else if (doc === "gst") {
      if ((await run(() => actions.gst(number))) === null) return setSending(false);
    }
    await upload();
    setSending(false);
  }
  const fileError = seen.file ? problemText(t, fileBad) : null;
  const fileField = (
    <RequiredField t={t} id={`kyc-file-${doc}`} label={t(`pick.kyc.doc.${doc}.file`)} hint={t("pick.kyc.file.hint")} error={fileError}>
      <input id={`kyc-file-${doc}`} type="file" required aria-required="true" aria-invalid={fileError ? true : undefined} aria-describedby={describedBy(`kyc-file-${doc}`, fileError)} accept="image/jpeg,image/png,application/pdf" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setSeen((x) => ({ ...x, file: true })))} className="min-h-12 w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-base text-ink" />
    </RequiredField>
  );
  const disabled = busy || sending;
  async function getLink() {
    setFail(null);
    const r = await actions.aadhaar();
    if (!r.ok) return setFail({ error: r.error, reason: r.reason });
    setLink(r.data.url);
    setOpenedAt(Date.now());
    setBack(false);
    setWaited(false);
  }
  if (doc === "aadhaar") {
    return (
      <div className="flex flex-col gap-4" data-part="doc-aadhaar">
        <p className="m-0 text-[15px] text-muted">{t("pick.kyc.aadhaar.body")}</p>
        {link ? (
          <div className="flex flex-col gap-2" data-part="digilocker">
            <a href={link} target="_blank" rel="noopener noreferrer" className="break-all text-[15px] font-semibold text-ink underline underline-offset-4">
              {t("pick.kyc.aadhaar.open")}
            </a>
            <p className="m-0 text-[15px] text-ink" data-part="aadhaar-stay">{t("pick.kyc.aadhaar.stay")}</p>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className={`${btnQuiet} w-fit`}>
              {t("pick.kyc.aadhaar.copy")}
            </button>
            {back || waited ? (
              <p className="m-0 flex flex-col items-start gap-1">
                <span className="text-[15px] text-muted">{t("pick.kyc.aadhaar.pending")}</span>
                <button type="button" data-part="aadhaar-again" disabled={disabled} onClick={() => void getLink()} className={btnQuiet}>
                  {t("pick.kyc.aadhaar.again")}
                </button>
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            <button type="button" data-part="get-link" disabled={disabled} onClick={() => void getLink()} className={btnQuiet}>
              {t("pick.kyc.aadhaar.get")}
            </button>
          </div>
        )}
        {link ? (
          <>
            {fileField}
            <div>
              <button type="button" data-part="send-doc" disabled={disabled || fileBad !== null} onClick={() => void send()} className={btnMain}>
                {t("pick.kyc.send")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }
  const numError = seen.number ? problemText(t, numberProblem) : null;
  const holderError = seen.holder ? problemText(t, holderBad) : null;
  const filled = numberProblem === null && holderBad === null;
  return (
    <div className="flex flex-col gap-4" data-part={`doc-${doc}`}>
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
        <RequiredField t={t} id={`kyc-num-${doc}`} label={t(doc === "pan" ? "pick.kyc.f.pan" : "pick.kyc.f.gst")} hint={doc === "gst" ? t("pick.kyc.f.gst.hint") : t("pick.kyc.f.pan.hint")} error={numError}>
          <input id={`kyc-num-${doc}`} type="text" required aria-required="true" aria-invalid={numError ? true : undefined} aria-describedby={describedBy(`kyc-num-${doc}`, numError)} onBlur={() => setSeen((x) => ({ ...x, number: true }))} autoCapitalize="characters" autoComplete="off" maxLength={doc === "pan" ? 10 : 15} value={number} onChange={(e) => setNumber(e.target.value.replace(/\s/g, "").toUpperCase())} className={fieldInput} />
        </RequiredField>
        {doc === "pan" ? (
          <RequiredField t={t} id="kyc-holder" label={t("pick.kyc.f.holder")} hint={t("pick.kyc.f.holder.hint")} error={holderError}>
            <input id="kyc-holder" type="text" required aria-required="true" aria-invalid={holderError ? true : undefined} aria-describedby={describedBy("kyc-holder", holderError)} onBlur={() => setSeen((x) => ({ ...x, holder: true }))} autoComplete="off" maxLength={120} value={holder} onChange={(e) => setHolder(e.target.value)} className={fieldInput} />
          </RequiredField>
        ) : null}
      </div>
      {fileField}
      <div>
        <button type="button" data-part="send-doc" disabled={disabled || !filled || fileBad !== null} onClick={() => void send()} className={btnMain}>
          {t("pick.kyc.send")}
        </button>
      </div>
    </div>
  );
}

/**
 * Step 3 of "Get a phone number", "Verify now" (owner, 26 Nov 2026): the same verification as the Verify-your-business page, drawn inside the step: Start verification, the details, PAN, Aadhaar (the link opens on the person's own phone: it is
 * them, not us, who confirm it), the GST papers for a business, "Send for checking", then the status, asked again every ten seconds while it is checked. It never reloads the page (a reload would swap this page for the verification page);
 * the parent hears each state through `onState` and goes on when it is `verified`.
 */
export function KycInline({ t, status: first, actions, canEdit, account, fullName, onState }: { t: Say; status: KycStatus; actions: VerifyActions; canEdit: boolean; account: AccountType; fullName: string; onState: (state: KycStatus["state"]) => void }) {
  const [status, setStatus] = React.useState(first);
  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<Fail | null>(null);
  const prefill = React.useMemo(() => ({ accountType: account, fullName }), [account, fullName]);
  React.useEffect(() => onState(status.state), [status.state, onState]);
  const run = async (go: () => Promise<KycResult>) => {
    setBusy(true);
    setFail(null);
    const r = await go();
    setBusy(false);
    if (!r.ok) {
      setFail({ error: r.error, reason: r.reason, missing: r.missing, fieldReasons: r.fieldReasons, needed: r.needed });
      return null;
    }
    setStatus(r.data);
    return r.data;
  };
  React.useEffect(() => {
    if (status.state !== "submitted" && status.state !== "waiting_for_line") return;
    const id = setInterval(() => void actions.status().then((s) => (s ? setStatus(s) : undefined)), status.state === "submitted" ? 10_000 : 15_000);
    return () => clearInterval(id);
  }, [status.state, actions]);
  const state = status.state;
  const chip = state === "verified" ? "done" : state === "submitted" || state === "waiting_for_line" ? "checking" : state === "stuck" ? "stuck" : "waiting";
  if (!canEdit) return <p className="m-0 text-[15px] text-muted">{t("pick.err.forbidden")}</p>;
  return (
    <div className="flex flex-col gap-4" data-part="verify-inline" data-state={state}>
      {state === "not_started" ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[15px] text-muted">{t("pick.buy.s3.now.start", { price: formatRupeesShort(EXTRA_NUMBER_PAISE) })}</p>
          <div>
            <button type="button" data-part="start-inline" disabled={busy} onClick={() => void run(() => actions.start(account))} className={btnMain}>
              {t("pick.kyc.start")}
            </button>
          </div>
          {fail?.error === "credits_needed" ? <CreditsNeeded t={t} needed={fail.needed} href={actions.creditsHref} /> : fail ? (
            <p role="alert" data-part="verify-error" data-error={fail.error} className="m-0 text-[15px] text-ink">
              {refusalSentence(t, fail.error, fail.reason)}
            </p>
          ) : null}
        </div>
      ) : null}
      {state !== "not_started" ? <ReserveNote t={t} status={status} canEdit={canEdit} busy={busy} onCancel={actions.cancel ? () => void run(actions.cancel as () => Promise<KycResult>) : undefined} /> : null}
      {state === "created" || state === "in_progress" ? <Flow t={t} status={status} actions={actions} prefill={prefill} busy={busy} run={run} fail={fail} setFail={setFail} refresh={setStatus} /> : null}
      {state === "waiting_for_line" ? (
        <p role="status" data-part="waiting-line" className="m-0 text-[15px] text-muted">
          {t("pick.kyc.waiting")}
        </p>
      ) : null}
      {state === "submitted" ? (
        <p role="status" className="m-0 text-[15px] text-muted">
          {t("pick.kyc.s4.checking")}
        </p>
      ) : null}
      {state === "stuck" ? (
        <p role="status" data-part="stuck" className="m-0 text-[15px] text-ink">
          {t("pick.kyc.err.stuck")}
        </p>
      ) : null}
      {state === "verified" ? (
        <p role="status" data-part="inline-verified" className="m-0 text-[15px] font-semibold text-ink">
          {t("pick.buy.s3.now.done")}
        </p>
      ) : null}
      {state !== "not_started" ? (
        <p data-part="verify-chip" data-chip={chip} className="m-0 inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden="true" className={`size-2 rounded-full ${chip === "done" ? "bg-green-text" : chip === "waiting" ? "bg-brand-text" : "bg-muted"}`} />
          {t(`pick.kyc.chip.${chip}`)}
        </p>
      ) : null}
    </div>
  );
}

/** The money step (C1, business-kyc.md): too little credit is not an error screen but one sentence and "Add credits"; nothing was created. */
export function CreditsNeeded({ t, needed, href }: { t: Say; needed?: string; href?: string }) {
  return (
    <div role="status" data-part="credits-needed" className="flex flex-col gap-2">
      <p className="m-0 text-[15px] text-ink">{t("pick.kyc.credits.needed", { needed: needed ?? formatRupeesShort(EXTRA_NUMBER_PAISE) })}</p>
      {href ? (
        <p className="m-0">
          <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-ink underline underline-offset-4">
            {t("pick.kyc.credits.add")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** The held first month of the number: what is held and that it comes back, with "Stop and get my credits back" (asks once). Nothing is drawn when nothing is held or refunded. */
export function ReserveNote({ t, status, canEdit, busy, onCancel }: { t: Say; status: KycStatus; canEdit: boolean; busy: boolean; onCancel?: () => void }) {
  const [asking, setAsking] = React.useState(false);
  const r = status.reserve;
  if (!r || (r.state !== "held" && r.state !== "refunded")) return null;
  const amount = r.amountText ?? r.priceText ?? formatRupeesShort(EXTRA_NUMBER_PAISE);
  if (r.state === "refunded") return <p role="status" data-part="reserve" className="m-0 text-[15px] text-muted">{t("pick.kyc.reserve.refunded", { amount })}</p>;
  return (
    <div data-part="reserve" data-state="held" className="flex flex-col gap-2">
      <p className="m-0 text-[15px] text-muted">{t("pick.kyc.reserve.held", { amount })}</p>
      {canEdit && onCancel && status.state !== "verified" ? (
        asking ? (
          <div role="group" aria-label={t("pick.kyc.reserve.stop")} className="flex flex-col gap-2">
            <p className="m-0 text-[15px] text-ink">{t("pick.kyc.reserve.ask", { amount })}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" data-part="reserve-yes" disabled={busy} onClick={() => (setAsking(false), onCancel())} className={btnMain}>
                {t("pick.kyc.reserve.yes")}
              </button>
              <button type="button" disabled={busy} onClick={() => setAsking(false)} className={btnQuiet}>
                {t("pick.kyc.reserve.no")}
              </button>
            </div>
          </div>
        ) : (
          <p className="m-0">
            <button type="button" data-part="reserve-stop" disabled={busy} onClick={() => setAsking(true)} className="min-h-11 text-[15px] text-muted underline underline-offset-4">
              {t("pick.kyc.reserve.stop")}
            </button>
          </p>
        )
      ) : null}
    </div>
  );
}
