"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { goalLength, goalProblem, GOAL_MAX, REFUSED_REASONS, refusedKey, type TestLanguage } from "@/lib/calls/test-call";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, kvList, noteBox, surface, warnBox } from "../ui";

type W = Readonly<Record<string, string>>;
export type PlaceFn = (input: { toId: string; language: TestLanguage; goal: string }) => Promise<
  { ok: true; callId: string } | { ok: false; error: string; reason?: string | null; problem?: string }
>;

export type TestNumberOption = { id: string; masked: string; label: string | null };

/**
 * "Place a test call" (Owner only): the phone (picked from the masked list of the test phones: the browser never holds a full number), the language and what the call is for, checked here with the API's own rules, then ONE clear second step ("This places a real phone call to a person you name") before anything is
 * sent. A call the gate refuses is said in plain words with its reason (nothing was dialled); a placed call opens the status page, which reads the call again while it is live. The goal is never kept here after it is sent.
 */
export function TestCallForm({ w, base, numbers, languages, place }: { w: W; base: string; numbers: readonly TestNumberOption[]; languages: readonly { code: TestLanguage; label: string }[]; place: PlaceFn }) {
  const router = useRouter();
  const [toId, setToId] = React.useState(numbers[0]?.id ?? "");
  const [language, setLanguage] = React.useState<TestLanguage>(languages[0]?.code ?? "en");
  const [goal, setGoal] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [step, setStep] = React.useState<"edit" | "sure">("edit");
  const [failed, setFailed] = React.useState<{ title: string | null; text: string; word: string | null } | null>(null);
  const [busy, startTransition] = React.useTransition();

  const picked = numbers.find((n) => n.id === toId) ?? null;
  const goalBad = goalProblem(goal);
  const showGoal = (touched || goal.trim() !== "") && goalBad !== null;
  const langLabel = languages.find((l) => l.code === language)?.label ?? language;

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setFailed(null);
    if (picked && goalBad === null) setStep("sure");
  };
  const send = () =>
    startTransition(async () => {
      const res = await place({ toId, language, goal });
      if (res.ok) {
        router.push(`${base}/calls/test?call=${encodeURIComponent(res.callId)}`);
        return;
      }
      setStep("edit");
      if (res.error === "refused") {
        const known = res.reason !== null && res.reason !== undefined && (REFUSED_REASONS as readonly string[]).includes(res.reason);
        setFailed({ title: w["tc.no.title"], text: w[refusedKey(res.reason)] ?? w["tc.no.other"], word: !known && res.reason ? w["tc.no.code"].replace("{word}", res.reason) : null });
      }
      else if (res.error === "provider") setFailed({ title: null, text: w["tc.err.provider"], word: null });
      else if (res.error === "forbidden") setFailed({ title: null, text: w["tc.err.forbidden"], word: null });
      else if (res.error === "off") setFailed({ title: null, text: w["tc.err.off"], word: null });
      else if (res.error === "invalid") {
        setFailed({ title: null, text: w["tc.err.invalid"], word: null });
        router.refresh(); // an id the server no longer knows: the list is read again
      } else if (res.error === "goal") setFailed({ title: null, text: w[`tc.goal.${res.problem ?? "short"}`] ?? w["tc.err.down"], word: null });
      else setFailed({ title: null, text: w["tc.err.down"], word: null });
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
            {picked?.masked}
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
          {failed.word ? <p className="m-0 mt-1 text-sm">{failed.word}</p> : null}
        </div>
      ) : null}
      <div>
        <label htmlFor="tc-to" className={fieldLabel}>
          {w["tc.to"]}
        </label>
        <select id="tc-to" dir="ltr" value={toId} disabled={numbers.length === 0} aria-describedby="tc-to-help" className={fieldInput} onChange={(e) => setToId(e.target.value)}>
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label ? `${n.label} ${n.masked}` : n.masked}
            </option>
          ))}
        </select>
        <p id="tc-to-help" className={fieldHelp}>
          {w["tc.to.help"]}
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
        <textarea id="tc-goal" rows={4} value={goal} placeholder={w["tc.goal.example"]} aria-invalid={showGoal} aria-describedby="tc-goal-help tc-goal-msg" className={fieldTextarea} onChange={(e) => setGoal(e.target.value)} onBlur={() => setTouched(true)} />
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
