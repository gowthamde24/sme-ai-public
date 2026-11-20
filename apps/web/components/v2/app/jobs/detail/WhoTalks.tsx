"use client";

import { Pause, Play, ShieldCheck } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { checkJobName, effectOf, fmtMinutes, JOB_NAME_MAX, type JobDetail } from "@/lib/jobs/detail";
import { jobNameKey } from "@/lib/jobs/types";
import { WHO_LANGUAGES, WHO_TONES, speaksPatch, type JobWho, type Speaks, type SpeaksKey, type SpeaksPatch, type WhoVoice } from "@/lib/jobs/who";

import { JobChip } from "../../ds/JobChip";
import { Radio } from "../../ds/Tick";
import type { Say } from "../../words";
import { PillSelect } from "./SettingLines";
import { WhoCommand, type WhoCommandProps } from "./WhoCommand";
import { jobBtnMain, jobBtnQuiet, jobCard, jobH2, type WhoExtra } from "./types";

export type WhoTalksProps = {
  jobId?: string;
  who?: JobWho;
  /** Or the whole job and the values now chosen: the card takes the job's id, who talks, business and the effect from them (so the job page passes two props, not four). */
  detail?: JobDetail;
  values?: Readonly<Record<string, string>>;
  /** The name shown now (the owner's name for the job, else the plain job name) and the plain name. */
  shownName?: string;
  customName: string | null;
  plainName?: string;
  business?: string;
  /** "What it will do" for this job from the page, as a sentence, or null. */
  effect?: string | null;
  /** Or the raw effect (the card writes the sentence itself, in the lazy chunk): the job's kind and `effectOf`'s answer. */
  fx?: { kind: string; who: string; steps: readonly { at: number }[] } | null;
  t: Say;
  canChange?: boolean;
  uiLang: string;
  /** This workspace's `voice-pick` route (the recorded sample of one voice) when it is on; null = no play buttons. */
  sampleEndpoint?: string | null;
  /** One change of how it sounds: the patch the adapter defines; the answer is whether it was saved (and why not). */
  onChange?: (patch: SpeaksPatch) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Or the job page's own save and what to do after a language change (the card builds `onChange` itself). */
  setSpeaks?: (patch: SpeaksPatch) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The job page's values: after a language change the card writes the new language into them ("What it says" follows). */
  setValues?: (change: (v: Record<string, string>) => Record<string, string>) => void;
  onRename: (name: string) => Promise<boolean>;
  command?: WhoCommandProps | null;
  /** The other jobs' side of "Make the visits job speak Telugu": the card builds its own command from this (kept here, in the lazy chunk, so the job page carries less code). */
  extra?: WhoExtra | null;
};

/**
 * THE "WHO TALKS" CARD of a job's page (JOBS, mock sheet r3-06): the job's own name ("Priya, the AI assistant of {business}" when a name is set, the plain job name when not), one plain sentence with the choices inside ("This job speaks [Telugu] in a [friendly] voice from [the shop number]"),
 * the three voices with a play button each (the voice sample route of Voice & tone), what it will do, the AI line that cannot be switched off, and "Make the visits job speak Telugu" as a command to the assistant with its plan card and Undo. Every choice is saved the moment it is
 * made (the adapter's one patch: lib/jobs/who.ts) and put back, with the reason, if the API says no. A person who only reads sees the same card with the choices off.
 */
export function WhoTalks(p: WhoTalksProps) {
  const sampleUrl = p.sampleEndpoint ?? p.extra?.sampleEndpoint ?? null;
  const plainName = p.plainName ?? p.t(jobNameKey(p.detail?.job.kind ?? "custom"));
  const shownName = p.shownName ?? p.customName ?? plainName;
  const jobId = p.jobId ?? p.detail?.job.id ?? "";
  const who = (p.who ?? p.detail?.who) as JobWho;
  const business = p.business ?? p.detail?.business ?? "";
  const fx = p.fx ?? (p.detail && p.values ? effectOf(p.detail.job.kind, p.values, p.detail.effectInputs) : null);
  const effectText = p.effect ?? (fx ? p.t(`jobs.effect.${p.fx?.kind ?? p.detail?.job.kind}`, { who: fx.who, t1: fmtMinutes(fx.steps[0].at), t2: fmtMinutes(fx.steps[1].at), t3: fmtMinutes(fx.steps[2].at) }) : null);
  async function saveSpeaks(patch: SpeaksPatch): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = p.setSpeaks ? await p.setSpeaks(patch) : { ok: false as const, error: "" };
    if (!r.ok) return { ok: false, error: r.error };
    const language = patch.language;
    if (language) p.setValues?.((v) => ({ ...v, language }));
    return { ok: true };
  }
  const target = p.extra?.target;
  const changeJob = p.extra?.changeJob;
  const command: WhoCommandProps | null =
    p.command ??
    (target && changeJob
      ? {
          jobId: target.id,
          jobName: target.customName ?? p.t(jobNameKey(target.kind)),
          short: p.t(`jobs.who.ask.job.${target.kind}`),
          from: target.language,
          to: target.to,
          change: async (jobId, patch) => {
            const r = await changeJob(jobId, patch);
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          },
        }
      : null);
  const { t } = p;
  const [now, setNow] = useState<Speaks>({ language: who.language, tone: who.tone, voice: who.voice, number: "shop" });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState<WhoVoice | null>(null);
  const [sampleError, setSampleError] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const off = !(p.canChange ?? !!p.setSpeaks);
  const checked = checkJobName(draft);
  const typed = checked.ok ? checked.name : draft.trim();

  async function choose(key: SpeaksKey, value: string) {
    const patch = speaksPatch(key, value);
    if (!patch || off) return;
    const before = now;
    setNow({ ...now, ...patch });
    setError(null);
    const r = await (p.onChange ?? saveSpeaks)(patch);
    if (!r.ok) {
      setNow(before);
      setError(r.error);
    }
  }
  function play(voice: WhoVoice) {
    audio.current?.pause();
    if (playing === voice) return setPlaying(null);
    if (!sampleUrl) return;
    setSampleError(false);
    const a = new Audio(`${sampleUrl}?id=${encodeURIComponent(voice)}&tone=${now.tone}`); // (a voice with no recording is spoken live in this tone)
    audio.current = a;
    a.onended = () => setPlaying((cur) => (cur === voice ? null : cur));
    a.onerror = () => (setPlaying(null), setSampleError(true));
    setPlaying(voice);
    a.play().catch(() => (setPlaying(null), setSampleError(true)));
  }
  async function saveName(raw: string) {
    const c = checkJobName(raw);
    if (!c.ok) return void setNameError(t(c.why === "long" ? "jobs.job.name.long" : "jobs.job.name.chars"));
    setSaving(true);
    const ok = await p.onRename(c.name ?? "");
    setSaving(false);
    if (ok) setEditing(false);
  }

  const plainSentence = t("jobs.who.sentence").replace(/\{\w+\}/g, "…");
  const langText = t(`jobs.opt.language.${now.language}`);
  // the number is the shop's, and only that (the second number is not a product): a plain word in the sentence, never a choice
  const numberText = t("jobs.who.number.shop");
  const masked = who.numbers.find((n) => n.key === "shop")?.masked ?? null;
  // the voices of the language this job speaks ("the customer's language" offers the app's own), by their first names: the same list as the voice card (`GET /ai-assistant/voices`); none read = no list
  const voiceLang = now.language === "customer" ? (["te", "hi", "kn", "en"].includes(p.uiLang) ? p.uiLang : "en") : now.language;
  const voices = (p.extra?.voices ?? []).filter((v) => v.language === voiceLang);
  const label = (n: number) => `${plainSentence} (${n})`;
  const parts: Record<string, () => ReactNode> = {
    language: () => <PillSelect label={label(1)} value={now.language} options={WHO_LANGUAGES} optionText={(v) => t(`jobs.opt.language.${v}`)} disabled={off} onChange={(v) => void choose("language", v)} />,
    tone: () => <PillSelect label={label(2)} value={now.tone} options={WHO_TONES} optionText={(v) => t(`jobs.who.tone.${v}`)} disabled={off} onChange={(v) => void choose("tone", v)} />,
    number: () => <b data-part="who-number-word" className="font-semibold">{numberText}</b>,
  };
  const sentence = t("jobs.who.sentence").split(/(\{language\}|\{tone\}|\{number\})/g);

  return (
    <section data-part="who-talks" aria-labelledby="who-h" className={jobCard}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="who-h" className={jobH2}>
          {t("jobs.who.title")}
        </h2>
        <JobChip tone="info">{t("jobs.who.ai_chip")}</JobChip>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-bg text-lg font-bold text-brand-text">
          {[...shownName][0] ?? "?"}
        </span>
        <p data-part="who-name" className="m-0 min-w-0 flex-1 truncate font-display text-[19px] font-bold leading-tight text-ink">
          {shownName}
        </p>
        {off || editing ? null : (
          <button type="button" data-action="who-rename" onClick={() => (setDraft(p.customName ?? ""), setNameError(null), setEditing(true))} className={jobBtnQuiet}>
            {t("jobs.job.rename")}
          </button>
        )}
      </div>
      {editing ? (
        <form
          data-part="who-rename-form"
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName(draft);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[15px] text-muted">{t("jobs.job.name.label")}</span>
            <input autoFocus value={draft} maxLength={JOB_NAME_MAX} onChange={(e) => (setDraft(e.target.value), setNameError(null))} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} className="min-h-12 w-full rounded-xl border-2 border-brand-edge bg-surface px-3 text-[17px] text-ink" />
          </label>
          <p aria-live="polite" className="m-0 text-[15px] text-muted">
            {typed ? t("jobs.job.name.hear", { name: typed, business: business }) : t("jobs.job.name.hear_plain", { business: business })}
          </p>
          <p className="m-0 text-[13.5px] text-muted">{t("jobs.who.name.help", { plain: plainName })}</p>
          {nameError ? (
            <p role="alert" className="m-0 text-sm text-red-text">
              {nameError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={jobBtnMain}>
              {t("jobs.job.name.save")}
            </button>
            <button type="button" disabled={saving} onClick={() => void saveName("")} className={jobBtnQuiet}>
              {t("jobs.job.name.plain")}
            </button>
          </div>
        </form>
      ) : (
        <p data-part="who-hear" className="m-0 mt-1.5 text-[15px] leading-snug text-muted">
          {p.customName ? t("jobs.job.name.hear", { name: p.customName, business: business }) : t("jobs.job.name.hear_plain", { business: business })}
        </p>
      )}

      <p data-part="who-sentence" aria-label={plainSentence} className="m-0 mt-3 text-[16px] leading-[2.3] text-ink">
        {sentence.map((part, i) => {
          const key = /^\{(\w+)\}$/.exec(part)?.[1];
          const draw = key ? parts[key] : undefined;
          return <Fragment key={i}>{draw ? draw() : part}</Fragment>;
        })}
      </p>
      <p data-part="who-tone-example" className="m-0 text-[14.5px] leading-snug text-muted">
        <b className="font-semibold text-ink capitalize">{t(`jobs.who.tone.${now.tone}`)}</b> {t(`jobs.who.tone.ex.${now.tone}`)}
        {masked ? <span data-part="who-number"> · {masked}</span> : null}
      </p>
      {error ? (
        <p role="alert" className="m-0 mt-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}

      {voices.length > 0 ? (
        <fieldset data-part="who-voices" className="m-0 mt-3 min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 text-[12px] font-bold uppercase tracking-wider text-muted">{t("jobs.who.voice")}</legend>
          <div className="flex flex-col">
            {voices.map((v) => (
              <div key={v.id} data-voice={v.id} className="flex items-center gap-2">
                <Radio className="min-w-0 flex-1" name={`who-voice-${jobId}`} value={v.id} checked={now.voice === v.id} disabled={off} onChange={() => void choose("voice", v.id)} label={<span className="text-[16px] font-semibold text-ink">{v.name}</span>} sub={v.recommended ? t("jobs.who.voice.recommended") : undefined} />
                {sampleUrl ? (
                  <button type="button" data-play={v.id} aria-pressed={playing === v.id} aria-label={`${t(playing === v.id ? "jobs.who.stop" : "jobs.who.play")}: ${v.name}`} onClick={() => play(v.id)} className={`${jobBtnQuiet} shrink-0`}>
                    {playing === v.id ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
                    {t(playing === v.id ? "jobs.who.stop" : "jobs.who.play")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {sampleUrl ? <p className="m-0 mt-1 text-sm text-muted">{sampleError ? t("jobs.who.sample.err") : t("jobs.who.sample.note")}</p> : null}
        </fieldset>
      ) : null}

      {effectText ? (
        <div data-part="who-effect" className="mt-3 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">
          <b>{t("jobs.job.effect")}</b> {effectText} {t("jobs.who.fx.talks", { name: shownName, language: langText, number: numberText })}
        </div>
      ) : null}

      {p.detail?.message ? (
        <p data-part="who-message" className="m-0 mt-3 text-[15px] leading-snug text-ink">
          {t("jobs.tb.uses", { title: p.uiLang === "te" && p.detail.message.title.te ? p.detail.message.title.te : p.detail.message.title.en })}
        </p>
      ) : null}

      <p data-part="who-ai-line" className="m-0 mt-3 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] leading-snug text-ink">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-muted" />
        {t("jobs.who.ai_line")}
      </p>

      {command && !off ? <WhoCommand {...command} t={t} /> : null}
    </section>
  );
}
