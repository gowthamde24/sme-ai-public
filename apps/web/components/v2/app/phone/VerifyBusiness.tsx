"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { AccountType, DocType, KycStatus } from "@/lib/api/business-kyc";
import type { KycResult } from "@/lib/phone-kyc/source";
import type { OwnNumber } from "@/lib/phone-picker/types";

import { Tick } from "../ds/Tick";
import { btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel } from "../ui";
import { makeT, type Say, type Words } from "../words";
import { PREFILL_KEY, refusalSentence } from "./PhoneBuy";
import { Notice, Seg, Step } from "./steps";

/**
 * "Verify your business" (KYC_PER_CLIENT; owner 29 Nov 2026; mock "Verify your business"): where the business's own phone account stands, as four steps (Number chosen, Calling account, Verify with PAN and Aadhaar, Ready to call), a neutral line that says what is
 * missing, and "Start verification", which opens the real steps one at a time: the details, PAN, Aadhaar (the link opens on the person's OWN phone: it is them, not us, who confirm it), the GST number and certificate for a business, then "Send for checking". A refusal is
 * one plain sentence. Documents go through our server to the phone service and are not kept; the numbers (PAN, GSTIN) are not kept either. The status is read again every few seconds while the check runs.
 */
export type VerifyActions = {
  status: () => Promise<KycStatus | null>;
  start: (type: AccountType) => Promise<KycResult>;
  details: (input: Record<string, unknown>) => Promise<KycResult>;
  pan: (panNumber: string, holderName: string) => Promise<KycResult>;
  gst: (gstNumber: string) => Promise<KycResult>;
  aadhaar: () => Promise<KycResult<{ url: string }>>;
  submit: () => Promise<KycResult>;
  /** the address that takes one document (multipart `type` + `file`); answers the same words as the actions */
  uploadUrl: string;
};
type Fail = { error: string; reason?: string; missing?: string[] };
const DOCS: Record<AccountType, readonly DocType[]> = { individual: ["pan", "aadhaar"], business: ["pan", "aadhaar", "gst"] };
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "application/pdf"];

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      {children}
      {hint ? <p className={`${fieldHelp} m-0`}>{hint}</p> : null}
    </div>
  );
}

export function VerifyBusiness({ words, status: first, own, canEdit, actions, buyHref, mock = false }: { words: Words; status: KycStatus; own: OwnNumber | null; canEdit: boolean; actions: VerifyActions; buyHref: string; mock?: boolean }) {
  const t = makeT(words);
  const router = useRouter();
  const [status, setStatus] = React.useState(first);
  const [open, setOpen] = React.useState(first.state === "created" || first.state === "in_progress");
  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<Fail | null>(null);
  const [type, setType] = React.useState<AccountType>(first.accountType ?? "individual");
  const [prefill] = React.useState<{ accountType?: AccountType; fullName?: string } | null>(() => {
    try {
      const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(PREFILL_KEY);
      return raw ? (JSON.parse(raw) as { accountType?: AccountType; fullName?: string }) : null;
    } catch {
      return null;
    }
  });

  const run = async (go: () => Promise<KycResult>) => {
    setBusy(true);
    setFail(null);
    const r = await go();
    setBusy(false);
    if (!r.ok) {
      setFail({ error: r.error, reason: r.reason, missing: r.missing });
      return null;
    }
    setStatus(r.data);
    return r.data;
  };

  // while the check runs, ask again every ten seconds; when it is done the page draws the finished state
  React.useEffect(() => {
    if (status.state !== "submitted") return;
    const id = setInterval(() => void actions.status().then((s) => (s ? (setStatus(s), s.state === "verified" ? router.refresh() : undefined) : undefined)), 10_000);
    return () => clearInterval(id);
  }, [status.state, actions, router]);

  const started = status.state !== "not_started";
  const verified = status.state === "verified";
  const submitted = status.state === "submitted";
  const stuck = status.state === "stuck";
  const working = started && !verified && !submitted && !stuck;
  const chip = verified ? "done" : submitted ? "checking" : stuck ? "stuck" : "waiting";

  return (
    <div className="flex max-w-3xl flex-col gap-4" data-part="verify" data-state={status.state}>
      {mock ? (
        <p className="m-0 text-sm text-muted" data-part="kyc-test">
          {t("pick.kyc.test")}
        </p>
      ) : null}
      {verified ? <Notice part="verify-note">{t("pick.kyc.verified")}</Notice> : own ? <Notice warn part="verify-note">{t("pick.kyc.blocked")}</Notice> : <Notice part="verify-note">{t("pick.kyc.nonumber")}</Notice>}
      <ol className="m-0 flex list-none flex-col p-0">
        <Step n={1} title={own ? t("pick.kyc.s1.t") : t("pick.kyc.s1.todo")} state={own ? "done" : "now"} summary={own ? t("pick.kyc.s1.body", { number: own.display }) : undefined}>
          {own ? null : (
            <p className="m-0 mt-2">
              <Link href={buyHref} prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">
                {t("pick.kyc.s1.link")}
              </Link>
            </p>
          )}
        </Step>
        <Step n={2} title={t("pick.kyc.s2.t")} state={started ? "done" : "now"} summary={started ? t(`pick.buy.type.${status.accountType ?? type}`) : undefined}>
          {started ? null : (
            <div className="mt-3 flex flex-col gap-4">
              <p className="m-0 text-[15px] text-muted">{t("pick.buy.s2.body")}</p>
              <Seg label={t("pick.buy.type")} value={type} options={[{ value: "individual", label: t("pick.buy.type.individual") }, { value: "business", label: t("pick.buy.type.business") }]} onChange={setType} disabled={busy} />
              {canEdit ? (
                <div>
                  <button type="button" data-part="start-account" disabled={busy} onClick={() => void run(() => actions.start(type)).then((s) => s && setOpen(true))} className={btnMain}>
                    {t("pick.kyc.start")}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </Step>
        <Step n={3} title={t("pick.kyc.s3.t")} state={verified || submitted ? "done" : working || stuck ? "now" : "off"}>
          {working || stuck ? <p className="m-0 mt-1 text-[15px] text-muted">{t(status.accountType === "business" || type === "business" ? "pick.kyc.s3.body.business" : "pick.kyc.s3.body")}</p> : null}
          {working && canEdit ? (
            open ? (
              <Flow t={t} status={status} actions={actions} prefill={prefill} busy={busy} run={run} fail={fail} setFail={setFail} />
            ) : (
              <div className="mt-3">
                <button type="button" data-part="start-verification" onClick={() => setOpen(true)} className={btnMain}>
                  {t("pick.kyc.start")}
                </button>
              </div>
            )
          ) : null}
          {working && !canEdit ? <p className="m-0 mt-2 text-[15px] text-muted">{t("pick.err.forbidden")}</p> : null}
          {stuck ? (
            <p role="status" data-part="stuck" className="m-0 mt-2 text-[15px] text-ink">
              {t("pick.kyc.err.stuck")}
            </p>
          ) : null}
        </Step>
        <Step n={4} title={t("pick.kyc.s4.t")} state={verified ? "done" : submitted ? "now" : "off"}>
          <p className="m-0 mt-1 text-[15px] text-muted">{verified ? t("pick.kyc.s4.done") : submitted ? t("pick.kyc.s4.checking") : t("pick.kyc.s4.body")}</p>
        </Step>
      </ol>
      <p data-part="verify-chip" data-chip={chip} className="m-0 inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden="true" className={`size-2 rounded-full ${chip === "done" ? "bg-green-text" : chip === "waiting" ? "bg-brand-text" : "bg-muted"}`} />
        {t(`pick.kyc.chip.${chip}`)}
      </p>
    </div>
  );
}

type FlowProps = { t: Say; status: KycStatus; actions: VerifyActions; prefill: { accountType?: AccountType; fullName?: string } | null; busy: boolean; run: (go: () => Promise<KycResult>) => Promise<KycStatus | null>; fail: Fail | null; setFail: (f: Fail | null) => void };

/** The real steps, one in hand at a time: the details, then each document (PAN, Aadhaar, and for a business the GST), then "Send for checking". */
function Flow({ t, status, actions, prefill, busy, run, fail, setFail }: FlowProps) {
  const account: AccountType = status.accountType ?? prefill?.accountType ?? "individual";
  const needs = DOCS[account];
  const details = status.state === "created";
  const next = needs.find((d) => status.steps[d] !== true) ?? null;
  const problem = fail ? (
    <div role="alert" data-part="verify-error" data-error={fail.error}>
      <p className="m-0 text-[15px] text-ink">{refusalSentence(t, fail.error, fail.reason)}</p>
      {fail.missing && fail.missing.length > 0 ? <p className="m-0 mt-1 text-[15px] text-ink">{t("pick.kyc.missing", { list: fail.missing.join(", ") })}</p> : null}
    </div>
  ) : null;
  return (
    <div className="mt-4 flex flex-col gap-5" data-part="verify-flow">
      {details ? <Details t={t} account={account} prefill={prefill} busy={busy} onSave={(input) => void run(() => actions.details(input))} /> : null}
      {!details ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {needs.map((d) => {
            const done = status.steps[d] === true;
            return (
              <li key={d} data-doc={d} data-done={done ? "" : undefined} className="flex flex-col gap-3 border-b border-line py-4 first:border-t first:border-t-ink">
                <div className="flex items-center justify-between gap-3">
                  <b className="text-base text-ink">{t(`pick.kyc.doc.${d}`)}</b>
                  <span className="text-sm text-muted">{done ? t("pick.kyc.uploaded") : d === next ? t("pick.kyc.chip.waiting") : ""}</span>
                </div>
                {d === next ? <DocStep t={t} doc={d} prefill={prefill} actions={actions} busy={busy} run={run} setFail={setFail} /> : null}
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

function Details({ t, account, prefill, busy, onSave }: { t: Say; account: AccountType; prefill: FlowProps["prefill"]; busy: boolean; onSave: (input: Record<string, unknown>) => void }) {
  const [v, setV] = React.useState({ businessName: "", fullName: prefill?.fullName ?? "", phone: "", billingAddress: "", city: "", state: "", pincode: "" });
  const [terms, setTerms] = React.useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form
      data-part="details"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ accountType: account, ...v, acceptTerms: terms });
      }}
    >
      {account === "business" ? (
        <Field id="kyc-biz" label={t("pick.kyc.f.business")}>
          <input id="kyc-biz" type="text" required maxLength={120} value={v.businessName} onChange={set("businessName")} className={fieldInput} />
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
        <Field id="kyc-name" label={t("pick.buy.name")}>
          <input id="kyc-name" type="text" required autoComplete="name" minLength={2} maxLength={120} value={v.fullName} onChange={set("fullName")} className={fieldInput} />
        </Field>
        <Field id="kyc-phone" label={t("pick.kyc.f.phone")}>
          <input id="kyc-phone" type="tel" required autoComplete="tel" inputMode="tel" maxLength={16} value={v.phone} onChange={set("phone")} className={fieldInput} />
        </Field>
      </div>
      <Field id="kyc-addr" label={t("pick.kyc.f.address")}>
        <input id="kyc-addr" type="text" required autoComplete="street-address" minLength={8} maxLength={300} value={v.billingAddress} onChange={set("billingAddress")} className={fieldInput} />
      </Field>
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-3">
        <Field id="kyc-city" label={t("pick.kyc.f.city")}>
          <input id="kyc-city" type="text" autoComplete="address-level2" maxLength={60} value={v.city} onChange={set("city")} className={fieldInput} />
        </Field>
        <Field id="kyc-state" label={t("pick.kyc.f.state")}>
          <input id="kyc-state" type="text" autoComplete="address-level1" maxLength={60} value={v.state} onChange={set("state")} className={fieldInput} />
        </Field>
        <Field id="kyc-pin" label={t("pick.kyc.f.pin")}>
          <input id="kyc-pin" type="text" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={v.pincode} onChange={(e) => setV((s) => ({ ...s, pincode: e.target.value.replace(/\D/g, "") }))} className={fieldInput} />
        </Field>
      </div>
      <div className="border-t border-ink">
        <Tick id="kyc-terms" checked={terms} onChange={(e) => setTerms(e.target.checked)} label={t("pick.kyc.f.terms")} />
      </div>
      <div>
        <button type="submit" data-part="save-details" disabled={busy || !terms} className={btnMain}>
          {t("pick.kyc.save")}
        </button>
      </div>
    </form>
  );
}

function DocStep({ t, doc, prefill, actions, busy, run, setFail }: { t: Say; doc: DocType; prefill: FlowProps["prefill"]; actions: VerifyActions; busy: boolean; run: FlowProps["run"]; setFail: FlowProps["setFail"] }) {
  const [number, setNumber] = React.useState("");
  const [holder, setHolder] = React.useState(prefill?.fullName ?? "");
  const [link, setLink] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [sending, setSending] = React.useState(false);

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
  const fileField = (
    <Field id={`kyc-file-${doc}`} label={t(`pick.kyc.doc.${doc}.file`)} hint={t("pick.kyc.file.hint")}>
      <input id={`kyc-file-${doc}`} type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-h-12 w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-base text-ink" />
    </Field>
  );
  const disabled = busy || sending;
  if (doc === "aadhaar") {
    return (
      <div className="flex flex-col gap-4" data-part="doc-aadhaar">
        <p className="m-0 text-[15px] text-muted">{t("pick.kyc.aadhaar.body")}</p>
        {link ? (
          <div className="flex flex-col gap-2" data-part="digilocker">
            <a href={link} target="_blank" rel="noopener noreferrer" className="break-all text-[15px] font-semibold text-ink underline underline-offset-4">
              {t("pick.kyc.aadhaar.open")}
            </a>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(link)} className={`${btnQuiet} w-fit`}>
              {t("pick.kyc.aadhaar.copy")}
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              data-part="get-link"
              disabled={disabled}
              onClick={async () => {
                setFail(null);
                const r = await actions.aadhaar();
                if (!r.ok) return setFail({ error: r.error, reason: r.reason });
                setLink(r.data.url);
              }}
              className={btnQuiet}
            >
              {t("pick.kyc.aadhaar.get")}
            </button>
          </div>
        )}
        {link ? (
          <>
            {fileField}
            <div>
              <button type="button" data-part="send-doc" disabled={disabled || !file} onClick={() => void send()} className={btnMain}>
                {t("pick.kyc.send")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }
  const filled = doc === "pan" ? number.trim().length === 10 && holder.trim().length >= 2 : number.trim().length === 15;
  return (
    <div className="flex flex-col gap-4" data-part={`doc-${doc}`}>
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2">
        <Field id={`kyc-num-${doc}`} label={t(doc === "pan" ? "pick.kyc.f.pan" : "pick.kyc.f.gst")} hint={doc === "gst" ? t("pick.kyc.f.gst.hint") : undefined}>
          <input id={`kyc-num-${doc}`} type="text" autoCapitalize="characters" autoComplete="off" maxLength={doc === "pan" ? 10 : 15} value={number} onChange={(e) => setNumber(e.target.value.replace(/\s/g, "").toUpperCase())} className={`${fieldInput} uppercase`} />
        </Field>
        {doc === "pan" ? (
          <Field id="kyc-holder" label={t("pick.kyc.f.holder")} hint={t("pick.kyc.f.holder.hint")}>
            <input id="kyc-holder" type="text" autoComplete="off" maxLength={120} value={holder} onChange={(e) => setHolder(e.target.value)} className={fieldInput} />
          </Field>
        ) : null}
      </div>
      {fileField}
      <div>
        <button type="button" data-part="send-doc" disabled={disabled || !filled || !file} onClick={() => void send()} className={btnMain}>
          {t("pick.kyc.send")}
        </button>
      </div>
    </div>
  );
}
