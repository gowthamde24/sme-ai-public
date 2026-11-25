"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { AccountType, KycStatus } from "@/lib/api/business-kyc";
import type { KycResult } from "@/lib/phone-kyc/source";
import type { OwnNumber } from "@/lib/phone-picker/types";

import { btnMain } from "../ui";
import { makeT, type Words } from "../words";
import { Flow, type Fail, type VerifyActions } from "./KycFlow";
import { PREFILL_KEY } from "./kyc-shared";
import { Notice, Seg, Step } from "./steps";

/**
 * "Verify your business" (KYC_PER_CLIENT; owner 29 Nov 2026; mock "Verify your business"): where the business's own phone account stands, as four steps (Number chosen, Calling account, Verify with PAN and Aadhaar, Ready to call), a neutral line that says what is
 * missing, and "Start verification", which opens the real steps one at a time: the details, PAN, Aadhaar (the link opens on the person's OWN phone: it is them, not us, who confirm it), the GST number and certificate for a business, then "Send for checking". A refusal is
 * one plain sentence. Documents go through our server to the phone service and are not kept; the numbers (PAN, GSTIN) are not kept either. The status is read again every few seconds while the check runs.
 */
export type { VerifyActions } from "./KycFlow";

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
      setFail({ error: r.error, reason: r.reason, missing: r.missing, fieldReasons: r.fieldReasons });
      return null;
    }
    setStatus(r.data);
    return r.data;
  };

  // while the check runs, ask again every ten seconds; when it is done the page draws the finished state
  React.useEffect(() => {
    // while the check runs (10 s) or while we set up the business's line at the phone service (15 s: C1's `waiting_for_line`), ask again
    if (status.state !== "submitted" && status.state !== "waiting_for_line") return;
    const id = setInterval(() => void actions.status().then((s) => (s ? (setStatus(s), s.state === "verified" ? router.refresh() : undefined) : undefined)), status.state === "submitted" ? 10_000 : 15_000);
    return () => clearInterval(id);
  }, [status.state, actions, router]);

  const started = status.state !== "not_started";
  const verified = status.state === "verified";
  const submitted = status.state === "submitted";
  const stuck = status.state === "stuck";
  const waitingLine = status.state === "waiting_for_line";
  const working = started && !verified && !submitted && !stuck && !waitingLine;
  const chip = verified ? "done" : submitted || waitingLine ? "checking" : stuck ? "stuck" : "waiting";

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
        <Step n={3} title={t("pick.kyc.s3.t")} state={verified || submitted ? "done" : working || stuck || waitingLine ? "now" : "off"}>
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
          {waitingLine ? (
            <p role="status" data-part="waiting-line" className="m-0 mt-2 text-[15px] text-muted">
              {t("pick.kyc.waiting")}
            </p>
          ) : null}
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

