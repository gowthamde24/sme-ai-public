"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import type { Employee, EmployeePatch, Refusal } from "@/lib/employees/types";

import { alertBox, btnMain, btnQuiet } from "../../ui";
import { makeT, type Words } from "../../words";
import { STEPS, WIZARD_LANGS, initialDraft, problemOf, rulesPatch, voicesFor, type Draft, type Problem, type Step, type VoiceCatalogue, type WizardActions, type WizardLang } from "./draft";
import { useSamplePlayer } from "./play";
import { StepJobs } from "./StepJobs";
import { StepName } from "./StepName";
import { StepOn } from "./StepOn";
import { StepPreview } from "./StepPreview";
import { StepRole } from "./StepRole";
import { StepRules } from "./StepRules";
import { StepVoice } from "./StepVoice";

/**
 * "New AI employee" (owner, 26 Nov 2026): seven screens, one at a time, with Back and Next and "Step 3 of 7". Everything chosen is kept here in the browser. The draft employee is made when the name is saved (step 2), with an id made ONCE when the wizard opens, so
 * a retry is the same employee and never a second one; steps 3 to 5 patch that draft; "Turn on" is the last move. Every refusal is drawn as the plain sentence `emp.err.<word>`.
 */
export function EmployeeWizard({ words, base, actions, voices }: { words?: Words; base: string; actions: WizardActions; voices: VoiceCatalogue }) {
  const t = makeT(words);
  const router = useRouter();
  const [id] = React.useState(() => crypto.randomUUID());
  const [step, setStep] = React.useState<Step>("role");
  const [draft, setDraft] = React.useState<Draft>(initialDraft);
  const [employee, setEmployee] = React.useState<Employee | null>(null);
  const [problem, setProblem] = React.useState<Problem | null>(null);
  const [busy, start] = React.useTransition();
  const savedLangs = React.useRef("");
  const savedVoices = React.useRef<Partial<Record<WizardLang, string>>>({});
  const heading = React.useRef<HTMLHeadingElement | null>(null);
  const moved = React.useRef(false);
  const index = STEPS.indexOf(step);
  const hasVoices = (l: WizardLang) => voicesFor(voices, l).length > 0;

  React.useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);

  const set = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setProblem(null);
  };
  const take = (e: Employee) => {
    setEmployee(e);
    setDraft((d) => (d.respTouched ? d : { ...d, responsibilities: [...e.responsibilities] }));
  };
  const fail = (e: Refusal) => setProblem({ key: `emp.err.${e}` });

  const patch = async (p: EmployeePatch): Promise<Refusal | null> => {
    const out = await actions.patch(id, p);
    if (!out.ok) return out.error;
    take(out.data);
    return null;
  };
  const saveLangs = async (langs: readonly WizardLang[]): Promise<Refusal | null> => {
    const key = langs.join(",");
    if (savedLangs.current === key) return null;
    const e = await patch({ languages: langs });
    if (!e) savedLangs.current = key;
    return e;
  };
  const saveVoice = async (lang: WizardLang, voiceId: string): Promise<Refusal | null> => {
    if (savedVoices.current[lang] === voiceId) return null;
    const out = await actions.setVoice(id, lang, voiceId);
    if (!out.ok) return out.error;
    savedVoices.current[lang] = voiceId;
    take(out.data);
    return null;
  };
  const saveVoiceFor = async (lang: WizardLang, voiceId: string) => (await saveLangs(draft.languages)) ?? (await saveVoice(lang, voiceId));
  const player = useSamplePlayer((language) => actions.preview(id, { language }));

  /** What each step saves to the draft employee when "Next" is pressed; the refusal, or null. */
  const save = async (s: Step): Promise<Refusal | null> => {
    if (s === "name" && draft.role) {
      const name = draft.name.trim();
      if (!employee) {
        const out = await actions.create({ id, roleCode: draft.role, name });
        if (!out.ok) return out.error;
        take(out.data);
        return null;
      }
      const p: EmployeePatch = { ...(employee.name !== name ? { name } : {}), ...(employee.roleCode !== draft.role ? { roleCode: draft.role } : {}) };
      return Object.keys(p).length === 0 ? null : patch(p);
    }
    if (s === "voice") {
      const e = await saveLangs(draft.languages);
      if (e) return e;
      for (const l of draft.languages) {
        const v = draft.voices[l];
        const failed = v ? await saveVoice(l, v) : null;
        if (failed) return failed;
      }
      return null;
    }
    if (s === "rules") {
      const p = rulesPatch(draft);
      return p ? patch(p) : "validation_error";
    }
    if (s === "jobs") return patch({ responsibilities: draft.responsibilities, roleTitle: draft.roleTitle.trim() === "" ? null : draft.roleTitle.trim() });
    return null;
  };

  const go = (to: number) => {
    player.stop();
    setProblem(null);
    setStep(STEPS[Math.min(Math.max(to, 0), STEPS.length - 1)] ?? "role");
  };
  const next = () => {
    const p = problemOf(step, draft, hasVoices);
    if (p) return setProblem(p);
    if (step === "role" || step === "preview") return go(index + 1); // nothing to save on these two
    start(async () => {
      const e = await save(step);
      if (e) return fail(e);
      go(index + 1);
    });
  };
  const turnOn = () =>
    start(async () => {
      const out = await actions.setStatus(id, "on");
      if (!out.ok) return fail(out.error);
      router.push(`${base}/employees/${id}`);
    });
  const toggleLang = (l: WizardLang) => {
    const on = draft.languages.includes(l);
    const rest = { ...draft.voices };
    if (on) delete rest[l];
    set({ languages: WIZARD_LANGS.filter((x) => (x === l ? !on : draft.languages.includes(x))), voices: rest });
  };
  const pick = (l: WizardLang, voiceId: string) => {
    set({ voices: { ...draft.voices, [l]: voiceId } });
    start(async () => {
      const e = await saveVoiceFor(l, voiceId);
      if (e) fail(e);
    });
  };

  const shown: Problem | null = problem ?? (player.error ? { key: `emp.err.${player.error}` } : null);
  const vars = shown?.vars && typeof shown.vars.language === "string" ? { ...shown.vars, language: CALL_LANG_NAMES[shown.vars.language as WizardLang] ?? shown.vars.language } : shown?.vars;
  const last = index === STEPS.length - 1;

  return (
    <section data-part="emp-wizard" aria-labelledby="wiz-h" className="flex flex-col gap-4">
      <nav aria-label={t("emp.wiz.steps")}>
        <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={s === step ? "step" : undefined} data-step={s} className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${s === step ? "border-brand-edge bg-brand-bg text-brand-text" : i < index ? "border-line bg-surface-2 text-ink" : "border-line text-muted"}`}>
              <span aria-hidden="true">{i + 1}</span>
              <span className={s === step ? "" : "sr-only"}>{t(`emp.wiz.step.${s}`)}</span>
            </li>
          ))}
        </ol>
      </nav>
      <p data-part="wiz-count" className="m-0 text-sm font-semibold text-muted">
        {t("emp.wiz.step_of", { n: index + 1, total: STEPS.length })}
      </p>
      <h2 id="wiz-h" ref={heading} tabIndex={-1} className="m-0 font-display text-2xl font-bold leading-tight text-ink outline-none">
        {t(`emp.wiz.${step}.h`)}
      </h2>
      <div>
        {step === "role" ? <StepRole t={t} d={draft} set={set} /> : null}
        {step === "name" ? <StepName t={t} d={draft} set={set} invalid={problem !== null} /> : null}
        {step === "voice" ? <StepVoice t={t} d={draft} catalogue={voices} toggleLang={toggleLang} pick={pick} play={(l) => void player.toggle(l, () => saveVoiceFor(l, draft.voices[l] ?? ""))} playing={player.playing} loading={player.loading} /> : null}
        {step === "rules" ? <StepRules t={t} d={draft} set={set} /> : null}
        {step === "jobs" ? <StepJobs t={t} d={draft} set={set} /> : null}
        {step === "preview" ? <StepPreview t={t} d={draft} employee={employee} said={player.said} play={(l) => void player.toggle(l)} playing={player.playing} loading={player.loading} /> : null}
        {last ? <StepOn t={t} d={draft} employee={employee} catalogue={voices} base={base} busy={busy} turnOn={turnOn} /> : null}
      </div>
      <p id="wiz-error" role="alert" data-part="wiz-error" className={shown ? `${alertBox} m-0` : undefined}>
        {shown ? t(shown.key, vars) : null}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {index === 0 ? (
          <Link href={`${base}/employees`} prefetch={false} data-part="wiz-back" className={btnQuiet}>
            {t("emp.wiz.back_list")}
          </Link>
        ) : (
          <button type="button" onClick={() => go(index - 1)} disabled={busy} data-part="wiz-back" className={btnQuiet}>
            {t("emp.wiz.back")}
          </button>
        )}
        {last ? null : (
          <button type="button" onClick={next} disabled={busy} data-part="wiz-next" className={btnMain}>
            {busy ? t("emp.wiz.saving") : t("emp.wiz.next")}
          </button>
        )}
      </div>
    </section>
  );
}
