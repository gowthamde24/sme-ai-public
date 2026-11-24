"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { Step } from "@/lib/api/signup-open";

import { authAlert, authChoice, authField, authHint, authLabel, authSubmit } from "./ui";

export type SignupStepWords = Readonly<Record<string, string>>;
type Actions = { consent: (t: { terms: boolean; privacy: boolean }) => Promise<Step>; start: (phone: string) => Promise<Step>; verify: (code: string) => Promise<Step> };

const fill = (s: string, v: string) => s.replace("{v}", v);

/**
 * The checks of opening sign-up, one at a time (C1's docs/contracts/signup.md): terms and privacy (two ticks, each with the version in force), then the mobile number and its 6-digit code. The next missing step is drawn; when all are done the page is read again and the
 * business set-up follows. Every refusal is one plain sentence (`su.err.*`); nothing here shows a code, a number or an e-mail address that was not typed by the person.
 */
export function SignupSteps({ words, step, versions, links, actions }: { words: SignupStepWords; step: "consent" | "phone"; versions: { terms: string; privacy: string }; links: { terms: string; privacy: string }; actions: Actions }) {
  const router = useRouter();
  const [terms, setTerms] = React.useState(false);
  const [privacy, setPrivacy] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const say = (r: Step) => (r.ok ? null : (words[`su.err.${r.reason}`] ?? words["su.err.unavailable"]));
  const run = async (fn: () => Promise<Step>, then: () => void) => {
    setBusy(true);
    setProblem(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) then();
    else setProblem(say(r));
  };
  if (step === "consent")
    return (
      <form
        data-part="signup-consent"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => actions.consent({ terms, privacy }), () => router.refresh());
        }}
      >
        <label className={authChoice}>
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>
            {fill(words["su.terms"], versions.terms)}{" "}
            <Link href={links.terms} target="_blank" className="font-semibold underline underline-offset-4">
              {words["su.read.terms"]}
            </Link>
          </span>
        </label>
        <label className={authChoice}>
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          <span>
            {fill(words["su.privacy"], versions.privacy)}{" "}
            <Link href={links.privacy} target="_blank" className="font-semibold underline underline-offset-4">
              {words["su.read.privacy"]}
            </Link>
          </span>
        </label>
        {problem ? (
          <p role="alert" className={authAlert}>
            {problem}
          </p>
        ) : null}
        <button type="submit" disabled={busy || !terms || !privacy} className={authSubmit}>
          {words["su.agree"]}
        </button>
      </form>
    );
  return (
    <form
      data-part="signup-phone"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!sent) void run(() => actions.start(phone), () => setSent(true));
        else void run(() => actions.verify(code), () => router.refresh());
      }}
    >
      <div className="flex flex-col">
        <label htmlFor="su-phone" className={authLabel}>
          {words["su.phone.l"]}
        </label>
        <input id="su-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={20} disabled={sent} onChange={(e) => setPhone(e.target.value)} className={authField} />
        <p className={authHint}>{words["su.phone.h"]}</p>
      </div>
      {sent ? (
        <div className="flex flex-col">
          <label htmlFor="su-code" className={authLabel}>
            {words["su.code.l"]}
          </label>
          <input id="su-code" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={authField} />
          <p role="status" className={authHint}>
            {words["su.code.sent"]}
          </p>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className={authAlert}>
          {problem}
        </p>
      ) : null}
      <button type="submit" disabled={busy || (sent ? code.length !== 6 : phone.trim().length < 8)} className={authSubmit}>
        {sent ? words["su.code.verify"] : words["su.phone.send"]}
      </button>
      {sent ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSent(false);
            setCode("");
            setProblem(null);
          }}
          className="self-start text-sm text-muted underline underline-offset-4"
        >
          {words["su.code.resend"]}
        </button>
      ) : null}
    </form>
  );
}
