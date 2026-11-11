"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { DEFAULT_TONE, goalLength, goalProblem, GOAL_MAX, REFUSED_REASONS, refusedKey, TEST_TONES, type TestLanguage, type TestTone } from "@/lib/calls/test-call";
import { INTRODUCE_KINDS, INTRODUCE_LIMITS, introducePreview, introduceProblem, type IntroduceAs, type IntroduceKind } from "@/lib/talk-training/introduce";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, noteBox, surface, warnBox } from "../ui";

// (not `kvList` from ../ui: a constant used by a client part is hoisted into the shared frame chunk, which is in every page's first load; the route-JS budget of /outbox has 29 B of room)
const facts = "mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-base [&>dt]:text-sm [&>dt]:font-semibold [&>dt]:text-muted [&>dd]:min-w-0 [&>dd]:break-words";

type W = Readonly<Record<string, string>>;
export type PlaceFn = (input: { toId: string; language: TestLanguage; goal: string | null; introduceAs?: IntroduceAs; tone?: TestTone }) => Promise<
  { ok: true; callId: string } | { ok: false; error: string; reason?: string | null; problem?: string | null }
>;

export type TestNumberOption = { id: string; masked: string; label: string | null };

/**
 * "Place a test call" (Owner only): the phone (picked from the masked list of the test phones: the browser never holds a full number), the language and what the call is for, checked here with the API's own rules, then ONE clear second step ("This places a real phone call to a person you name") before anything is
 * sent. A call the gate refuses is said in plain words with its reason (nothing was dialled); a placed call opens the status page, which reads the call again while it is live. The goal is never kept here after it is sent.
 */
/** "Introduce as" for this call only (C1, 11 Nov): `saved` = the Talk training setting; null = the API has no such field (nothing is offered or sent). */
export type IntroduceOffer = { saved: IntroduceAs; business: string | null };
export function TestCallForm({ w, base, numbers, languages, place, introduce = null, tone = false }: { w: W; base: string; numbers: readonly TestNumberOption[]; languages: readonly { code: TestLanguage; label: string }[]; place: PlaceFn; introduce?: IntroduceOffer | null; /** The Tone choice (TEST_CALL_TONE, until C1's `tone` field exists it is not offered) */ tone?: boolean }) {
  const router = useRouter();
  const [toId, setToId] = React.useState(numbers[0]?.id ?? "");
  const [language, setLanguage] = React.useState<TestLanguage>(languages[0]?.code ?? "en");
  const [mode, setMode] = React.useState<"goal" | "line">("goal"); // "line" = the line check: no goal, always English
  const [goal, setGoal] = React.useState("");
  const [introKind, setIntroKind] = React.useState<"saved" | IntroduceKind>("saved");
  const [introText, setIntroText] = React.useState("");
  const [toneChoice, setToneChoice] = React.useState<TestTone>(DEFAULT_TONE);
  const [touched, setTouched] = React.useState(false);
  const [step, setStep] = React.useState<"edit" | "sure">("edit");
  const [failed, setFailed] = React.useState<{ title: string | null; text: string; word: string | null } | null>(null);
  const [busy, startTransition] = React.useTransition();

  const picked = numbers.find((n) => n.id === toId) ?? null;
  // "Introduce as" for this call: the saved setting unless the owner picks another for this call only (goal calls: the line check has its own fixed opening)
  const tpl = { business: w["tt.intro.pre.business"] ?? "", owner: w["tt.intro.pre.owner"] ?? "", custom: w["tt.intro.pre.custom"] ?? "" };
  const chosen: IntroduceAs | null = introduce === null || mode === "line" ? null : introKind === "saved" ? null : introKind === "business" ? { kind: "business", text: null } : { kind: introKind, text: introText };
  const introBad = chosen === null ? null : introduceProblem(chosen);
  const introShown = introduce === null || mode === "line" ? null : introducePreview(chosen ?? introduce.saved, introduce.business, tpl);
  const line = mode === "line";
  const goalBad = line ? null : goalProblem(goal);
  const showGoal = (touched || goal.trim() !== "") && goalBad !== null;
  const sentLanguage: TestLanguage = line ? "en" : language;
  const langLabel = languages.find((l) => l.code === sentLanguage)?.label ?? sentLanguage;

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setFailed(null);
    if (picked && goalBad === null && introBad === null) setStep("sure");
  };
  const send = () =>
    startTransition(async () => {
      const res = await place({ toId, language: sentLanguage, goal: line ? null : goal, ...(chosen ? { introduceAs: chosen } : {}), ...(tone && !line ? { tone: toneChoice } : {}) });
      if (res.ok) {
        router.push(`${base}/calls?test=1&call=${encodeURIComponent(res.callId)}`);
        return;
      }
      setStep("edit");
      if (res.error === "refused") {
        const known = res.reason !== null && res.reason !== undefined && (REFUSED_REASONS as readonly string[]).includes(res.reason);
        setFailed({ title: w["tc.no.title"], text: w[refusedKey(res.reason)] ?? w["tc.no.other"], word: !known && res.reason ? w["tc.no.code"].replace("{word}", res.reason) : null });
      }
      else if (res.error === "introduce") setFailed({ title: null, text: (res.problem ? w[`tt.intro.no.${res.problem}`]?.replace("{min}", String(INTRODUCE_LIMITS.custom.min)).replace("{max}", String(INTRODUCE_LIMITS.custom.max)) : null) ?? w["tc.err.introduce"], word: null });
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
        <p className="m-0 text-base">{w[line ? "tc.sure.body.line" : "tc.sure.body"]}</p>
        <p className="m-0 text-sm text-muted">{w["tc.kept"]}</p>
        <dl className={facts}>
          <dt>{w["tc.review.to"]}</dt>
          <dd className="font-semibold" dir="ltr">
            {picked?.masked}
          </dd>
          <dt>{w["tc.language"]}</dt>
          <dd>{langLabel}</dd>
          {tone && !line ? (
            <>
              <dt>{w["tc.tone.review"]}</dt>
              <dd>{w[`tc.tone.${toneChoice}`]}</dd>
            </>
          ) : null}
          {introShown ? (
            <>
              <dt>{w["tc.intro.review"]}</dt>
              <dd>{introShown}</dd>
            </>
          ) : null}
          <dt>{w["tc.review.goal"]}</dt>
          <dd>{line ? w["tc.line.review"] : goal.trim().replace(/\s+/g, " ")}</dd>
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
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={fieldLabel}>{w["tc.mode"]}</legend>
        {(["goal", "line"] as const).map((m) => (
          <label key={m} className="mt-2 flex cursor-pointer items-start gap-3 text-base">
            <input type="radio" name="tc-mode" value={m} checked={mode === m} className="mt-1 h-5 w-5 shrink-0" onChange={() => { setMode(m); setFailed(null); }} />
            <span>
              <span className="font-semibold">{w[`tc.mode.${m}`]}</span>
              <span className={`${fieldHelp} block`}>{w[`tc.mode.${m}.help`]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {line ? null : (
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
      )}
      {line ? null : (
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
      )}
      {tone && !line ? (
        <div data-part="test-call-tone">
          <label htmlFor="tc-tone" className={fieldLabel}>
            {w["tc.tone.label"]}
          </label>
          <select id="tc-tone" value={toneChoice} aria-describedby="tc-tone-help" className={fieldInput} onChange={(e) => setToneChoice(e.target.value as TestTone)}>
            {TEST_TONES.map((x) => (
              <option key={x} value={x}>
                {w[`tc.tone.${x}`]}
              </option>
            ))}
          </select>
          <p id="tc-tone-help" className={fieldHelp}>
            {w["tc.tone.help"]}
          </p>
        </div>
      ) : null}
      {introduce === null || line ? null : (
        <fieldset className="m-0 min-w-0 border-0 p-0" data-part="test-call-introduce">
          <legend className={fieldLabel}>{w["tc.intro.label"]}</legend>
          <label htmlFor="tc-intro" className="sr-only">
            {w["tc.intro.label"]}
          </label>
          <select id="tc-intro" value={introKind} className={fieldInput} onChange={(e) => setIntroKind(e.target.value as "saved" | IntroduceKind)}>
            <option value="saved">{w["tc.intro.saved"]}</option>
            {INTRODUCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {w[`tt.intro.kind.${k}`]}
              </option>
            ))}
          </select>
          {introKind === "owner" || introKind === "custom" ? (
            <div className="mt-2">
              <input type="text" value={introText} aria-label={w[introKind === "owner" ? "tt.intro.name" : "tt.intro.words"]} aria-invalid={introText !== "" && introBad !== null} placeholder={w[introKind === "owner" ? "tt.intro.name.eg" : "tt.intro.words.eg"]} className={fieldInput} onChange={(e) => setIntroText(e.target.value)} />
              <p className={`${fieldHelp} ${introText !== "" || touched ? (introBad ? "font-semibold text-red-text" : "") : ""}`} aria-live="polite" data-part="test-call-introduce-msg">
                {(introText !== "" || touched) && introBad ? w[`tt.intro.no.${introBad}`].replace("{min}", String(INTRODUCE_LIMITS[introKind].min)).replace("{max}", String(INTRODUCE_LIMITS[introKind].max)) : w[introKind === "owner" ? "tt.intro.rule.owner" : "tt.intro.rule.custom"].replace("{min}", String(INTRODUCE_LIMITS[introKind].min)).replace("{max}", String(INTRODUCE_LIMITS[introKind].max))}
              </p>
            </div>
          ) : null}
          <p className="mt-2 text-base" data-part="test-call-introduce-preview" aria-live="polite">
            <span className="text-sm text-muted">{w["tt.intro.preview"]} </span>
            {introShown}
          </p>
        </fieldset>
      )}
      <p className={`${noteBox} m-0`}>{w["tc.kept"]}</p>
      <div>
        <button type="submit" className={btnMain} data-part="test-call-check">
          {w["tc.check"]}
        </button>
      </div>
    </form>
  );
}
