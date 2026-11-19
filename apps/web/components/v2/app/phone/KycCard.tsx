"use client";

import Link from "next/link";
import * as React from "react";

import { fileTypeOf, fieldProblems, DEFINITE_REFUSALS, normalNumber, type DocKind, type FieldProblem, type KycBody, type KycOptions, type KycReply, type KycStatus, CAN_SEND } from "@/lib/phone-kyc/types";

import { postJson } from "../cc/post";
import { sentenceOf, type Failed } from "../cc/kit";
import type { FileProblem } from "../ds/FileField";
import { LazyFileField } from "../ds/LazyFileField";
import { StatusPill } from "../ds/StatusPill";
import { alertBox, btnMain, fieldHelp, fieldInput, fieldLabel, okBox, warnBox } from "../ui";
import { card } from "../v6/ui";
import { makeT, type Words } from "../words";
import { PILL, WORD, apiFileName, newAttemptId, readBase64, type Shown } from "./kyc-model";

/**
 * The registration (KYC) card of the Phone number page: before a business can choose its number, the phone company needs to know the business. ONE of three documents is enough (GST, Udyam, company or LLP registration; the API's `options` say which are
 * offered). The card says where it stands in plain words (not started, being checked, registered, not accepted with the phone company's own reason and "Fix and send again", being set up) and, for the Owner, shows the form. An Admin reads the state only.
 * The file is read in the browser (FileReader, base64) at the moment the button is pressed and goes in ONE request to our route (not a server action: 5 MB is over its limit); no other copy is made and none is kept. Pressing the button again after a lost
 * answer sends the same attempt id, so the filing is made once; after the phone company refused the filing the next try is a new attempt.
 */
type Send = (body: KycBody) => Promise<KycReply>;
type Typed = { docKind: DocKind; number: string; legal: string; email: string; addr1: string; addr2: string; city: string; state: string; postal: string };
const EMPTY: Omit<Typed, "docKind" | "email"> = { number: "", legal: "", addr1: "", addr2: "", city: "", state: "", postal: "" };

export function KycCard({ words, status: initial, options, canEdit, defaultEmail = "", endpoint, send }: { words: Words; status: KycStatus | null; options: KycOptions | null; canEdit: boolean; defaultEmail?: string; endpoint: string; send?: Send }) {
  const t = makeT(words);
  const id = React.useId();
  const [status, setStatus] = React.useState(initial);
  const [typed, setTyped] = React.useState<Typed>({ ...EMPTY, docKind: options?.documents[0]?.kind ?? "gst", email: defaultEmail });
  const [file, setFile] = React.useState<File | null>(null);
  const [fileProblem, setFileProblem] = React.useState<"file" | "file_type" | "file_size" | "file_read" | null>(null);
  const [problems, setProblems] = React.useState<Partial<Record<FieldProblem, true>>>({});
  const [failure, setFailure] = React.useState<(Failed & { reason?: string }) | null>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const attempt = React.useRef<string | null>(null);

  const shown: Shown = status ? status.state : "unavailable";
  const word = WORD[shown];
  const sendable = status !== null && CAN_SEND.has(status.state);
  const form = canEdit && sendable && options !== null;
  const again = status !== null && status.state !== "not_started";
  const doc = options?.documents.find((d) => d.kind === typed.docKind) ?? options?.documents[0] ?? null;
  const maxBytes = options?.maxFileBytes ?? 5_000_000;
  const mb = String(Math.floor(maxBytes / 1_000_000));
  const set = (k: FieldProblem & keyof Typed) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setTyped({ ...typed, [k]: e.target.value });
    if (problems[k]) setProblems({ ...problems, [k]: undefined });
  };

  // the field checks the kind and size before a single byte is read (the API checks again) and says which was wrong
  const chosen = (f: File | null, problem?: FileProblem) => {
    setFile(f);
    setFileProblem(problem === "type" ? "file_type" : problem === "size" ? "file_size" : problem === "empty" ? "file_read" : null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !options || !doc) return;
    setFailure(null);
    setSaid(null);
    const found = fieldProblems(typed);
    setProblems(found);
    const fileBad = file === null ? (fileProblem ?? "file") : null;
    if (fileBad) setFileProblem(fileBad);
    if (Object.keys(found).length > 0 || fileBad) return;
    const type = fileTypeOf(file!.name, file!.type);
    if (type === null) return setFileProblem("file_type");
    setBusy(true);
    let data: string;
    try {
      data = await readBase64(file!);
    } catch {
      setBusy(false);
      return setFileProblem("file_read");
    }
    attempt.current ??= newAttemptId();
    const body: KycBody = {
      kyc_id: attempt.current,
      doc_kind: typed.docKind,
      legal_name: typed.legal.trim(),
      registration_number: normalNumber(typed.number),
      email: typed.email.trim(),
      address_line1: typed.addr1.trim(),
      address_line2: typed.addr2.trim(),
      city: typed.city.trim(),
      state: typed.state.trim(),
      postal_code: typed.postal.trim(),
      document: { name: apiFileName(file!.name), content_type: type, data_base64: data },
    };
    const out = await (send ?? ((b: KycBody) => postJson<KycStatus>(endpoint, b) as Promise<KycReply>))(body).catch((): KycReply => ({ ok: false, kind: "unavailable", error: "" }));
    setBusy(false);
    if (out.ok) {
      attempt.current = null;
      setStatus(out.data);
      setSaid(out.data.live ? t("phkyc.sent") : t("phkyc.sent.test"));
      return;
    }
    // the phone company or our checks refused this filing as it is: the next try is a new attempt. A lost answer (no network, the phone company did not answer) is the SAME attempt: it files once.
    if (out.code && DEFINITE_REFUSALS.has(out.code)) attempt.current = null;
    if (out.code === "kyc_file_too_large") setFileProblem("file_size");
    setFailure(out);
  }

  const fieldError = (k: FieldProblem, text: string) =>
    problems[k] ? (
      <p id={`${id}-${k}-bad`} role="alert" className="mt-1.5 text-sm font-medium text-red-text">
        {text}
      </p>
    ) : null;
  const attrs = (k: FieldProblem) => ({ "aria-invalid": problems[k] ? true : undefined, "aria-describedby": problems[k] ? `${id}-${k}-bad` : undefined });
  const anyProblem = Object.keys(problems).some((k) => problems[k as FieldProblem]) || fileProblem !== null;

  return (
    <section aria-labelledby={`${id}-title`} data-part="phone-kyc-card" data-kyc-state={shown} className={`${card} max-w-2xl`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="font-display text-xl font-semibold">
          {t("phkyc.title")}
        </h2>
        <StatusPill status={PILL[shown]}>{t(`phkyc.state.${word}`)}</StatusPill>
      </div>
      <p className="mt-2 text-base text-muted" data-part="kyc-text">
        {t(`phkyc.text.${word}`)}
      </p>
      {status && !status.live ? (
        <p className={warnBox} data-part="kyc-testmode">
          {t("phkyc.testmode")}
        </p>
      ) : null}
      {status?.reason && (status.state === "rejected" || status.state === "failed") ? (
        <p className={alertBox} data-part="kyc-reason">
          <span className="font-semibold">{t("phkyc.reason")}</span> <span className="[overflow-wrap:anywhere]">{status.reason}</span>
        </p>
      ) : null}
      {!canEdit && sendable ? <p className={fieldHelp}>{t("phkyc.owneronly")}</p> : null}
      {canEdit && sendable && options === null ? <p className={fieldHelp}>{t("phkyc.setting_up")}</p> : null}

      {form && options && doc ? (
        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4" data-part="kyc-form">
          <fieldset className="m-0 border-0 p-0">
            <legend className={fieldLabel}>{t("phkyc.doc.title")}</legend>
            <div className="flex flex-col" role="radiogroup">
              {options.documents.map((d) => (
                <label key={d.kind} className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
                  <input
                    type="radio"
                    name="kyc-doc"
                    value={d.kind}
                    checked={typed.docKind === d.kind}
                    onChange={() => {
                      setTyped({ ...typed, docKind: d.kind, number: "" });
                      setProblems({ ...problems, number: undefined });
                    }}
                    className="size-6 shrink-0 accent-brand-text"
                  />
                  {t(`phkyc.doc.${d.kind}`)}
                </label>
              ))}
            </div>
            <p className={fieldHelp}>{t("phkyc.doc.one")}</p>
          </fieldset>

          <div>
            <label htmlFor={`${id}-number`} className={fieldLabel}>
              {doc.numberLabel}
            </label>
            <input id={`${id}-number`} value={typed.number} onChange={set("number")} autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${fieldInput} font-mono`} {...attrs("number")} />
            <p className={fieldHelp}>{t("phkyc.number.example", { example: doc.numberExample })}</p>
            {fieldError("number", t("phkyc.bad.number", { label: doc.numberLabel, example: doc.numberExample }))}
          </div>
          <div>
            <label htmlFor={`${id}-legal`} className={fieldLabel}>
              {t("phkyc.f.legal")}
            </label>
            <input id={`${id}-legal`} value={typed.legal} onChange={set("legal")} autoComplete="organization" maxLength={100} className={fieldInput} {...attrs("legal")} />
            <p className={fieldHelp}>{t("phkyc.f.legal.help")}</p>
            {fieldError("legal", t("phkyc.bad.legal"))}
          </div>
          <div>
            <label htmlFor={`${id}-email`} className={fieldLabel}>
              {t("phkyc.f.email")}
            </label>
            <input id={`${id}-email`} type="email" value={typed.email} onChange={set("email")} autoComplete="email" maxLength={120} className={fieldInput} {...attrs("email")} />
            {fieldError("email", t("phkyc.bad.email"))}
          </div>
          <div>
            <label htmlFor={`${id}-addr1`} className={fieldLabel}>
              {t("phkyc.f.addr1")}
            </label>
            <input id={`${id}-addr1`} value={typed.addr1} onChange={set("addr1")} autoComplete="address-line1" maxLength={120} className={fieldInput} {...attrs("addr1")} />
            {fieldError("addr1", t("phkyc.bad.addr1"))}
          </div>
          <div>
            <label htmlFor={`${id}-addr2`} className={fieldLabel}>
              {t("phkyc.f.addr2")}
            </label>
            <input id={`${id}-addr2`} value={typed.addr2} onChange={set("addr2")} autoComplete="address-line2" maxLength={120} className={fieldInput} {...attrs("addr2")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor={`${id}-city`} className={fieldLabel}>
                {t("phkyc.f.city")}
              </label>
              <input id={`${id}-city`} value={typed.city} onChange={set("city")} autoComplete="address-level2" maxLength={60} className={fieldInput} {...attrs("city")} />
              {fieldError("city", t("phkyc.bad.city"))}
            </div>
            <div>
              <label htmlFor={`${id}-state`} className={fieldLabel}>
                {t("phkyc.f.state")}
              </label>
              <input id={`${id}-state`} value={typed.state} onChange={set("state")} autoComplete="address-level1" maxLength={60} className={fieldInput} {...attrs("state")} />
              {fieldError("state", t("phkyc.bad.state"))}
            </div>
            <div>
              <label htmlFor={`${id}-postal`} className={fieldLabel}>
                {t("phkyc.f.postal")}
              </label>
              <input id={`${id}-postal`} value={typed.postal} onChange={set("postal")} inputMode="numeric" autoComplete="postal-code" maxLength={6} className={fieldInput} {...attrs("postal")} />
              {fieldError("postal", t("phkyc.bad.postal"))}
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-file`} className={fieldLabel}>
              {t("phkyc.f.file")}
            </label>
            <LazyFileField
              id={`${id}-file`}
              words={words}
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              maxBytes={maxBytes}
              isAccepted={(f) => fileTypeOf(f.name, f.type) !== null}
              typeError={t("phkyc.bad.file_type")}
              sizeError={t("phkyc.bad.file_size", { mb })}
              emptyError={t("phkyc.bad.file_read")}
              error={fileProblem ? t(`phkyc.bad.${fileProblem}`, { mb }) : undefined}
              help={t("phkyc.f.file.help", { mb })}
              onFile={chosen}
            />
          </div>
          <p className={fieldHelp} data-part="kyc-kept">
            {t("phkyc.kept")}
          </p>
          {anyProblem ? (
            <p role="alert" className={alertBox} data-part="kyc-summary">
              {t("phkyc.bad.summary")}
            </p>
          ) : null}
          {failure ? (
            <div role="alert" className={alertBox} data-part="kyc-failure">
              <p className="m-0">
                {sentenceOf(failure, t)}
                {failure.kind === "mfa" ? (
                  <>
                    {" "}
                    <Link href="/app/security" className="font-semibold underline">
                      {t("apierr.security_link")}
                    </Link>
                  </>
                ) : null}
              </p>
              {failure.reason ? (
                <p className="mb-0 mt-2" data-part="kyc-failure-reason">
                  <span className="font-semibold">{t("phkyc.reason")}</span> <span className="[overflow-wrap:anywhere]">{failure.reason}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          <div>
            <button type="submit" disabled={busy} className={btnMain}>
              {busy ? t("dta.btn.working") : t(again ? "phkyc.btn.again" : "phkyc.btn.send")}
            </button>
          </div>
        </form>
      ) : null}
      {said ? (
        <p role="status" className={status?.live ? okBox : warnBox} data-part="kyc-said">
          {said}
        </p>
      ) : null}
    </section>
  );
}
