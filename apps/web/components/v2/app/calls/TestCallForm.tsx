"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { goalLength, goalProblem, GOAL_MAX, numberProblem, refusedKey, type TestLanguage } from "@/lib/calls/test-call";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, kvList, noteBox, surface, warnBox } from "../ui";

type W = Readonly<Record<string, string>>;
export type PlaceFn = (input: { to: string; language: TestLanguage; goal: string }) => Promise<
  { ok: true; callId: string } | { ok: false; error: string; reason?: string | null; problem?: string }
>;

/**
 * "Place a test call" (Owner only): the number, the language and what the call is for, checked here with the API's own rules, then ONE clear second step ("This places a real phone call to a person you name") before anything is
 * sent. A call the gate refuses is said in plain words with its reason (nothing was dialled); a placed call opens the status page, which reads the call again while it is live. The goal is never kept here after it is sent.
 */
export function TestCallForm({ w, base, languages, place }: { w: W; base: string; languages: readonly { code: TestLanguage; label: string }[]; place: PlaceFn }) {
  const router = useRouter();
  const [to, setTo] = React.useState("+91 ");
  const [language, setLanguage] = React.useState<TestLanguage>(languages[0]?.code ?? "en");
  const [goal, setGoal] = React.useState("");
  const [touched, setTouched] = React.useState({ to: false, goal: false });
  const [step, setStep] = React.useState<"edit" | "sure">("edit");
  const [failed, setFailed] = React.useState<{ title: string | null; text: string } | null>(null);
  const [busy, startTransition] = React.useTransition();

  const toBad = numberProblem(to) !== null;
  const goalBad = goalProblem(goal);
  const showTo = touched.to && toBad;
  const showGoal = (touched.goal || goal.trim() !== "") && goalBad !== null;
  const langLabel = languages.find((l) => l.code === language)?.label ?? language;

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ to: true, goal: true });
    setFailed(null);
    if (!toBad && goalBad === null) setStep("sure");
  };
  const send = () =>
    startTransition(async () => {
      const res = await place({ to, language, goal });
      if (res.ok) {
        router.push(`${base}/calls/test?call=${encodeURIComponent(res.callId)}`);
        return;
      }
      setStep("edit");
      if (res.error === "refused") setFailed({ title: w["tc.no.title"], text: w[refusedKey(res.reason)] ?? w["tc.no.other"] });
      else if (res.error === "provider") setFailed({ title: null, text: w["tc.err.provider"] });
      else if (res.error === "forbidden") setFailed({ title: null, text: w["tc.err.forbidden"] });
      else if (res.error === "to") setFailed({ title: null, text: w["tc.to.bad"] });
      else if (res.error === "goal") setFailed({ title: null, text: w[`tc.goal.${res.problem ?? "short"}`] ?? w["tc.err.down"] });
      else setFailed({ title: null, text: w["tc.err.down"] });
    });

  if (step === "sure")
    return (
      <section className={`${surface} flex flex-col gap-4`} data-part="test-call-sure" aria-labelledby="tc-sure-h">
        <p id="tc-sure-h" role="alert" className={`${warnBox} m-0 text-base font-bold`}>
          {w["tc.sure.title"]}
        </p>
        <p className="m-0 text-base">{w["tc.sure.body"]}</p>
        <p className="m-0 text-sm text-muted">{w["tc.kept"]}</p>
        <dl className={kvList}>
          <dt>{w["tc.review.to"]}</dt>
          <dd className="font-semibold" dir="ltr">
            {to.trim()}
          </dd>
          <dt>{w["tc.language"]}</dt>
          <dd>{langLabel}</dd>
          <dt>{w["tc.review.goal"]}</dt>
          <dd>{goal.trim().replace(/\s+/g, " ")}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={btnMain} onClick={send} data-part="test-call-place">
            {busy ? w["tc.placing"] : w["tc.sure.yes"]}
          </button>
          <button type="button" disabled={busy} className={btnQuiet} onClick={() => setStep("edit")}>
            {w["tc.sure.no"]}
          </button>
        </div>
      </section>
    );

  return (
    <form className={`${surface} flex flex-col gap-5`} data-part="test-call-form" onSubmit={check} noValidate>
      {failed ? (
        <div role="alert" className={`${alertBox} m-0`} data-part="test-call-refused">
          {failed.title ? <p className="m-0 font-bold">{failed.title}</p> : null}
          <p className="m-0">{failed.text}</p>
        </div>
      ) : null}
      <div>
        <label htmlFor="tc-to" className={fieldLabel}>
          {w["tc.to"]}
        </label>
        <input id="tc-to" type="tel" inputMode="tel" autoComplete="off" dir="ltr" maxLength={20} value={to} aria-invalid={showTo} aria-describedby="tc-to-help" className={fieldInput} onChange={(e) => setTo(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, to: true }))} />
        <p id="tc-to-help" className={showTo ? "mt-1.5 text-sm font-semibold text-red-text" : fieldHelp}>
          {showTo ? w["tc.to.bad"] : w["tc.to.help"]}
        </p>
      </div>
      <div>
        <label htmlFor="tc-lang" className={fieldLabel}>
          {w["tc.language"]}
        </label>
        <select id="tc-lang" value={language} className={fieldInput} onChange={(e) => setLanguage(e.target.value as TestLanguage)}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="tc-goal" className={fieldLabel}>
          {w["tc.goal"]}
        </label>
        <textarea id="tc-goal" rows={4} value={goal} placeholder={w["tc.goal.example"]} aria-invalid={showGoal} aria-describedby="tc-goal-help tc-goal-msg" className={fieldTextarea} onChange={(e) => setGoal(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, goal: true }))} />
        <p id="tc-goal-help" className={fieldHelp}>
          {w["tc.goal.help"]}
        </p>
        <p id="tc-goal-msg" className="mt-1.5 flex flex-wrap justify-between gap-2 text-sm" aria-live="polite">
          <span className={showGoal ? "font-semibold text-red-text" : "text-muted"}>{showGoal && goalBad ? w[`tc.goal.${goalBad}`] : ""}</span>
          <span className={goalLength(goal) > GOAL_MAX ? "font-semibold text-red-text" : "text-muted"}>{w["tc.goal.count"].replace("{n}", String(goalLength(goal)))}</span>
        </p>
      </div>
      <p className={`${noteBox} m-0`}>{w["tc.kept"]}</p>
      <div>
        <button type="submit" className={btnMain} data-part="test-call-check">
          {w["tc.check"]}
        </button>
      </div>
    </form>
  );
}
