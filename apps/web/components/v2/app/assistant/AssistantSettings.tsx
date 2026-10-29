"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import { sayLine } from "@/lib/assistant/lines";
import { sampleUrl } from "@/lib/voice-samples/types";
import type { TestCall, TestCallResult } from "@/lib/assistant/test-call";
import { CALL_LANGS, DAYS, HOURS, NAME_MAX, SPEED, STYLES, parseSettings, validName, type AssistantSettings as Settings, type CallLang, type Day, type Voice } from "@/lib/assistant/types";
import type { AssistantProfile } from "@/lib/assistant/defaults";

import { btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, surface } from "../ui";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant/name";
import { SAMPLE_CUSTOMER, SAMPLE_ROLE, fillOpening } from "@/lib/opening-line/types";
import { makeT, type Words } from "../words";

export type AssistantActions = { save: (input: unknown) => Promise<{ ok: true } | { ok: false; error: string }>; /** The simulated test call (job DQ part 3); absent = the button is not drawn. */ testCall?: () => Promise<TestCallResult> };
/** The voice samples (job DQ part 3): where the browser asks for one (our own route), and whether it is the fake sound of the test screens. null = no "Hear it" anywhere. */
export type SampleSource = { endpoint: string; mock: boolean };
const block = `${surface} flex flex-col gap-4`;
const opt = (on: boolean) => `flex items-center gap-3 rounded-2xl border p-3.5 text-left ${on ? "border-brand-edge bg-brand-bg ring-2 ring-brand/25" : "border-line bg-surface hover:bg-surface-2"}`;
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="flex min-h-11 w-full items-center justify-between gap-4 border-t border-line py-2 text-left text-base first:border-t-0 disabled:opacity-70">
      <span>{label}</span>
      <span aria-hidden="true" className={`relative inline-flex h-[26px] w-11 shrink-0 rounded-full ${on ? "bg-brand-edge" : "bg-edge"}`}>
        <span className={`absolute top-[3px] size-5 rounded-full bg-white ${on ? "right-[3px]" : "left-[3px]"}`} />
      </span>
    </button>
  );
}

/**
 * Settings > AI assistant (job DM, from Setup.dc.html): the assistant's name (the words "AI assistant" are always said), a voice, the languages (main, switch to the customer's, mixing English), a way of talking and a speed, what it
 * may do on calls (and the highest discount), when it hands over to the owner, the calling hours, and on the right a live preview with the circle speaking. It starts from the defaults of the business type (`profile`), so an owner can
 * skip it; nothing is kept until "Save". Only the Owner can change it (`canEdit`). Voice samples and test calls do not exist yet, so "Hear it" is switched off and "Call me now for a test" says so. The words come in as props.
 */
export function AssistantSettings({ words, initial, profile, shop, langs, voiceNames, canEdit, testMode, saved, actions, samples = null, voicePickerOn = false, voiceInUse = null, defaultName = null, openingLine = null }: { words: Words; initial: Settings; profile: AssistantProfile; shop: string; langs: Record<CallLang, string>; voiceNames: Record<Voice, string>; canEdit: boolean; testMode: boolean; saved: boolean; actions: AssistantActions; /** The Owner has made a voice of their own (job DP): it can be chosen. */ /** The voice picker's samples (job DQ part 3). */ samples?: SampleSource | null; /** The voice picker (a voice for each language, below) is on: the four-persona list is not shown, unless the Owner's own voice is in use or ready to use (it is chosen here). */ voicePickerOn?: boolean; /** The catalogue voice the workspace speaks in for the main language (Settings > Voice picks it), shown on the preview; null = not known. */ voiceInUse?: { name: string; label: string } | null; /** How the default name reads on the screen ("Your assistant", in the person's language), for a workspace whose owner has not named the assistant. */ defaultName?: string | null; /** The opening line a call speaks, per language (the saved line, else the default by the AI switch): the card shows it instead of an example sentence. */ openingLine?: { lines: Partial<Record<CallLang, string>>; defaults: Record<CallLang, string> } | null }) {
  const t = makeT(words);
  const router = useRouter();
  const [s, setS] = React.useState<Settings>(initial);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<"saved" | "error" | "test" | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [sampleErr, setSampleErr] = React.useState(false);
  const [heard, setHeard] = React.useState<string | null>(null); // the words of the preview that was played (the real names in them)
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [test, setTest] = React.useState<{ state: "idle" } | { state: "running" } | { state: "error" } | { state: "done"; call: TestCall }>({ state: "idle" });
  React.useEffect(() => () => audio.current?.pause(), []);
  /** Plays one voice's sample in the language and tone now chosen; the one that was playing stops. A browser that will not play it, or a sample that is not there, says so. */
  const hear = () => {
    if (!samples) return;
    audio.current?.pause();
    if (playing) return setPlaying(false);
    setSampleErr(false);
    setHeard(null);
    const q = { voice: s.voice === "own_voice" ? ("female_warm" as const) : s.voice, lang: s.lang, tone: "warm" as const, name: nameOnScreen }; // (with the voice catalogue on, the sound is the saved line in the voice in force: these two only name the old sample)
    if (!samples.mock) {
      // the exact words the sound says are shown beside the player (with the voice catalogue: the saved opening line with the business's real names), so what is read is what is heard
      void fetch(`${sampleUrl(samples.endpoint, q)}&text=1`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { text?: unknown } | null) => setHeard(typeof j?.text === "string" ? j.text : null))
        .catch(() => setHeard(null));
    }
    const a = new Audio(sampleUrl(samples.endpoint, q));
    audio.current = a;
    a.onended = () => setPlaying(false);
    a.onerror = () => {
      setPlaying(false);
      setSampleErr(true);
    };
    setPlaying(true);
    a.play().catch(() => {
      setPlaying(false);
      setSampleErr(true);
    });
  };
  const [mfa, setMfa] = React.useState(false); // the save needs the authenticator app (the API asks the owner for the second factor)
  const set = (p: Partial<Settings>) => {
    setNote(null);
    setS((x) => ({ ...x, ...p }));
  };
  const nameBlank = s.name.trim() === "";
  const nameOnScreen = s.name.trim() || defaultName || DEFAULT_ASSISTANT_NAME; // an unsaved workspace has no name: "your assistant", in the person's language
  const nameOk = validName(s.name);
  const hoursOk = s.hours.from < s.hours.to && s.hours.days.length > 0;
  const rangeOk = s.hours.from >= HOURS.min && s.hours.to <= HOURS.max && [s.hours.from, s.hours.to].every((h) => Number(h.slice(3, 5)) % HOURS.stepMinutes === 0);
  const toggleDay = (d: Day) => set({ hours: { ...s.hours, days: s.hours.days.includes(d) ? s.hours.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || s.hours.days.includes(x)) } });
  const shownName = s.name.trim() === "" || s.name.trim() === DEFAULT_ASSISTANT_NAME ? (defaultName ?? DEFAULT_ASSISTANT_NAME) : s.name.trim(); // (the owner's own name is used as written)
  // what the card says is the opening line a call speaks: the owner's saved line, else the default of the language (by the AI switch); the old example sentence only where the line is not known
  const template = openingLine ? (openingLine.lines[s.lang] ?? openingLine.defaults[s.lang]) : null;
  const line = template ? fillOpening(template, { customer: SAMPLE_CUSTOMER[s.lang], assistant: shownName, business: shop, agent_role: SAMPLE_ROLE[s.lang] }) : sayLine(s.lang, s.style, nameOnScreen, shop);
  const ok = parseSettings(s) !== null;
  return (
    <div data-settings="assistant" data-assistant-saved={saved ? "true" : "false"} className="@container flex flex-col gap-5">
      <div>
        <h2 className="font-display text-2xl font-bold leading-tight">{t("asst.title")}</h2>
        <p className="mt-1 text-base text-muted">{t("asst.intro")}</p>
        {testMode ? (
          <p role="note" className="mt-3 rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
            {t("asst.testmode")}
          </p>
        ) : null}
        {!saved ? <p className="mt-2 text-sm text-muted">{t("asst.defaults")}</p> : null}
        {!canEdit ? <p className="mt-2 text-sm font-medium">{t("asst.forbidden")}</p> : null}
      </div>
      {/* the page keeps a narrow column: the preview stands above the form, and beside it only when the column is wide (a container query, not the screen) */}
      <div className="flex flex-col gap-5 @5xl:flex-row @5xl:items-start">
        <form
          data-write
          className="flex min-w-0 flex-1 flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canEdit || !ok) return setNote("error");
            setBusy(true);
            let done = false;
            let needsSecondFactor = false;
            try {
              const r = await actions.save(s);
              done = r.ok;
              needsSecondFactor = !r.ok && r.error === "mfa";
            } catch {
              done = false;
            }
            setBusy(false);
            setMfa(needsSecondFactor);
            setNote(done ? "saved" : "error");
            if (done) router.refresh();
          }}
        >
          <fieldset disabled={!canEdit || busy} className="contents">
            <section className={block} aria-labelledby="asst-name-h">
              <div>
                <h3 id="asst-name-h" className="text-[17px] font-semibold">{t("asst.name.t")}</h3>
                <p className="text-sm text-muted">{t("asst.name.d", { name: nameOnScreen, shop })}</p>
              </div>
              <label htmlFor="asst-name" className="sr-only">{t("asst.name.label")}</label>
              <input id="asst-name" value={s.name} maxLength={NAME_MAX} onChange={(e) => set({ name: e.target.value })} placeholder={defaultName ?? DEFAULT_ASSISTANT_NAME} aria-invalid={!nameOk && !nameBlank} aria-describedby={nameOk ? undefined : "asst-name-err"} className={`${fieldInput} max-w-xs`} />
              {nameBlank && !saved ? <p id="asst-name-err" className="text-sm text-muted">{t("asst.name.need")}</p> : nameOk ? null : (
                <p id="asst-name-err" role="alert" className="text-sm font-medium text-red-text">
                  {t("asst.name.err", { n: NAME_MAX })}
                </p>
              )}
            </section>

            <section className={block} aria-labelledby="asst-lang-h">
              <div>
                <h3 id="asst-lang-h" className="text-[17px] font-semibold">{t("asst.lang.t")}</h3>
                <p className="text-sm text-muted">{t("asst.lang.d")}</p>
              </div>
              <div role="radiogroup" aria-labelledby="asst-lang-h" className="flex flex-wrap gap-2">
                {CALL_LANGS.map((l) => (
                  <button key={l} type="button" role="radio" lang={l} aria-checked={s.lang === l} onClick={() => set({ lang: l })} className={chip(s.lang === l)}>
                    {langs[l]}
                  </button>
                ))}
              </div>
              <Switch on={s.autoSwitch} label={t("asst.lang.auto")} onChange={(v) => set({ autoSwitch: v })} disabled={!canEdit || busy} />
              <Switch on={s.mixEnglish} label={t("asst.lang.mix")} onChange={(v) => set({ mixEnglish: v })} disabled={!canEdit || busy} />
            </section>

            <section className={block} aria-labelledby="asst-style-h">
              <div>
                <h3 id="asst-style-h" className="text-[17px] font-semibold">{t("asst.style.t")}</h3>
                <p className="text-sm text-muted">{t("asst.style.d")}</p>
              </div>
              <div role="radiogroup" aria-labelledby="asst-style-h" className="grid gap-2.5 sm:grid-cols-3">
                {STYLES.map((st) => (
                  <button key={st} type="button" role="radio" aria-checked={st === s.style} onClick={() => set({ style: st })} className={`${opt(st === s.style)} flex-col !items-start`}>
                    <strong className="text-[15px]">{t(`asst.style.${st}` as "asst.style.warm")}</strong>
                    <span className="text-[13px] leading-snug text-muted">{t(`asst.style.${st}.d` as "asst.style.warm.d")}</span>
                  </button>
                ))}
              </div>
              <label htmlFor="asst-speed" className="flex justify-between text-sm text-muted">
                <span>{t("asst.speed")}</span>
                <span>{s.speed.toFixed(2).replace(/0$/, "")}×</span>
              </label>
              <input id="asst-speed" type="range" min={SPEED.min} max={SPEED.max} step={SPEED.step} value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })} className="w-full accent-brand-edge" />
            </section>

            <section className={block} aria-labelledby="asst-may-h">
              <h3 id="asst-may-h" className="text-[17px] font-semibold">{t("asst.may.t")}</h3>
              <div>
                {profile.mayRows.map((k) => (
                  <Switch key={k} on={s.may[k]} label={t(`asst.may.${k}` as "asst.may.prices")} onChange={(v) => set({ may: { ...s.may, [k]: v } })} disabled={!canEdit || busy} />
                ))}
              </div>
              {profile.discount ? (
                <div>
                  <label htmlFor="asst-discount" className={fieldLabel}>{t("asst.discount")}</label>
                  <div className="flex items-center gap-2">
                    <input id="asst-discount" type="number" inputMode="numeric" min={0} max={50} step={1} value={s.maxDiscount} onChange={(e) => set({ maxDiscount: Math.max(0, Math.min(50, Math.trunc(Number(e.target.value) || 0))) })} className={`${fieldInput} max-w-[7rem]`} />
                    <span aria-hidden="true" className="text-base font-semibold">%</span>
                  </div>
                  <p className={fieldHelp}>{t("asst.discount.help")}</p>
                </div>
              ) : null}
            </section>

            <section className={block} aria-labelledby="asst-hand-h">
              <div>
                <h3 id="asst-hand-h" className="text-[17px] font-semibold">{t("asst.handover.t")}</h3>
                <p className="text-sm text-muted">{t("asst.handover.d")}</p>
              </div>
              <div>
                <Switch on={s.handover.owner} label={t("asst.handover.owner")} onChange={(v) => set({ handover: { ...s.handover, owner: v } })} disabled={!canEdit || busy} />
                <Switch on={s.handover.upset} label={t("asst.handover.upset")} onChange={(v) => set({ handover: { ...s.handover, upset: v } })} disabled={!canEdit || busy} />
              </div>
              {profile.orderLimit ? (
                <div>
                  <label htmlFor="asst-above" className={fieldLabel}>{t("asst.handover.above")}</label>
                  <input id="asst-above" type="number" inputMode="numeric" min={0} step={1} value={s.handover.orderAbove ?? ""} onChange={(e) => set({ handover: { ...s.handover, orderAbove: e.target.value === "" ? null : Math.max(0, Math.trunc(Number(e.target.value) || 0)) } })} className={`${fieldInput} max-w-[12rem]`} />
                  <p className={fieldHelp}>{t("asst.handover.above.help")}</p>
                </div>
              ) : null}
              <div className="border-t border-line pt-3">
                <h4 className="text-base font-semibold">{t("asst.hours.t")}</h4>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <div>
                    <label htmlFor="asst-from" className={fieldLabel}>{t("asst.hours.from")}</label>
                    <input id="asst-from" type="time" min={HOURS.min} max={HOURS.max} step={HOURS.stepMinutes * 60} value={s.hours.from} onChange={(e) => set({ hours: { ...s.hours, from: e.target.value } })} className={fieldInput} />
                  </div>
                  <div>
                    <label htmlFor="asst-to" className={fieldLabel}>{t("asst.hours.to")}</label>
                    <input id="asst-to" type="time" min={HOURS.min} max={HOURS.max} step={HOURS.stepMinutes * 60} value={s.hours.to} onChange={(e) => set({ hours: { ...s.hours, to: e.target.value } })} className={fieldInput} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("asst.hours.t")}>
                  {DAYS.map((d) => (
                    <button key={d} type="button" aria-pressed={s.hours.days.includes(d)} onClick={() => toggleDay(d)} className={chip(s.hours.days.includes(d))}>
                      {t(`asst.day.${d}` as "asst.day.mon")}
                    </button>
                  ))}
                </div>
                {hoursOk ? null : (
                  <p role="alert" className="mt-2 text-sm font-medium text-red-text">
                    {t("asst.hours.err")}
                  </p>
                )}
                {rangeOk ? null : (
                  <p role="alert" className="mt-2 text-sm font-medium text-red-text">
                    {t("asst.hours.range")}
                  </p>
                )}
              </div>
            </section>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!canEdit || busy || !ok} className={btnMain}>
              {t("asst.save")}
            </button>
            {note === "saved" ? <p role="status" className="text-base font-medium text-green-text">{t("asst.saved")}</p> : null}
            {note === "error" ? <p role="alert" className="text-base font-medium text-red-text">{t(mfa ? "asst.save.mfa" : "asst.save.err")}</p> : null}
          </div>
        </form>

        <aside aria-labelledby="asst-prev-h" className="order-first flex flex-col gap-4 rounded-3xl bg-charcoal p-6 text-on-charcoal @5xl:sticky @5xl:top-24 @5xl:order-none @5xl:w-[380px] @5xl:flex-none">
          <h3 id="asst-prev-h" className="text-xs font-bold uppercase tracking-[0.14em] text-brand">{t("asst.preview")}</h3>
          <div className="flex justify-center py-2">
            <Orb px={120} state="speak" halo />
          </div>
          <div className="flex flex-col gap-1 text-center">
            <strong className="text-lg">{t("asst.preview.who", { name: shownName })}</strong>
            <span className="text-[13px] opacity-80">
              {voicePickerOn && voiceInUse ? `${voiceInUse.name} · ${voiceInUse.label}` : voiceNames[s.voice]} · {t(`asst.style.${s.style}` as "asst.style.warm")} · {s.speed.toFixed(2).replace(/0$/, "")}×
            </span>
          </div>
          <p lang={s.lang} data-part="preview-line" className="m-0 text-center text-[17px] leading-relaxed">
            “{line}”
          </p>
          <p data-part="disclosure" className="text-center text-xs opacity-80">{t("asst.disclosure")}</p>
          <button type="button" disabled={!samples} onClick={hear} className={`${btnQuiet} !border-white/30 !bg-transparent !text-on-charcoal ${samples ? "" : "opacity-60"}`}>
            ▶ {t("asst.hear")}
          </button>
          {samples ? null : <p className="text-center text-xs opacity-80">{t("asst.hear.soon")}</p>}
          {sampleErr ? <p role="alert" className="text-center text-xs font-medium">{t("asst.sample.err")}</p> : null}
          {heard ? (
            <p lang={s.lang} className="rounded-lg bg-white/10 px-3 py-2 text-center text-sm" data-part="preview-text" aria-live="polite">
              <span className="block font-semibold opacity-80">{t("asst.preview.heard")}</span>
              {heard}
            </p>
          ) : null}
          {actions.testCall ? (
            <button
              type="button"
              disabled={!canEdit || test.state === "running"}
              onClick={async () => {
                setTest({ state: "running" });
                try {
                  const r = await actions.testCall!();
                  setTest(r.ok ? { state: "done", call: r.call } : { state: "error" });
                } catch {
                  setTest({ state: "error" });
                }
              }}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 text-[15px] font-bold text-ink disabled:opacity-60"
            >
              {t("asst.test")}
            </button>
          ) : (
            <button type="button" disabled={!canEdit} onClick={() => setNote("test")} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 text-[15px] font-bold text-ink disabled:opacity-60">
              {t("asst.test")}
            </button>
          )}
          <p className="text-center text-xs opacity-80">{!actions.testCall && note === "test" ? t("asst.test.soon") : t("asst.test.note")}</p>
          {test.state === "running" ? <p role="status" className="text-center text-sm">{t("asst.test.running")}</p> : null}
          {test.state === "error" ? <p role="alert" className="text-center text-sm font-medium text-red-text">{t("asst.test.err")}</p> : null}
          {test.state === "done" ? (
            <div data-part="test-call" role="status" className="rounded-2xl border border-white/20 p-3 text-left">
              <h4 className="text-sm font-bold">{t("asst.test.title")}</h4>
              <p className="mt-1 text-xs opacity-80">{test.call.note}</p>
              <ol className="mt-2 flex flex-col gap-2">
                {test.call.transcript.map((row, i) => (
                  <li key={i} lang={s.lang} className="text-sm">
                    <span className="font-semibold">{t(`asst.test.who.${row.speaker}` as "asst.test.who.assistant")}: </span>
                    {row.text}
                  </li>
                ))}
              </ol>
              {test.call.outcome ? <p className="mt-2 text-sm font-semibold">{t("asst.test.outcome", { reason: test.call.outcome.reason })}</p> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
