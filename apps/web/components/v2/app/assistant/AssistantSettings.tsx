"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import { sayLine } from "@/lib/assistant/lines";
import { CALL_LANGS, DAYS, HOURS, NAME_MAX, SPEED, STYLES, VOICES, parseSettings, validName, type AssistantSettings as Settings, type CallLang, type Day, type Voice } from "@/lib/assistant/types";
import type { AssistantProfile } from "@/lib/assistant/defaults";

import { btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, surface } from "../ui";
import { makeT, type Words } from "../words";

export type AssistantActions = { save: (input: unknown) => Promise<{ ok: true } | { ok: false; error: string }> };
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
export function AssistantSettings({ words, initial, profile, shop, langs, voiceNames, canEdit, testMode, saved, actions }: { words: Words; initial: Settings; profile: AssistantProfile; shop: string; langs: Record<CallLang, string>; voiceNames: Record<Voice, string>; canEdit: boolean; testMode: boolean; saved: boolean; actions: AssistantActions }) {
  const t = makeT(words);
  const router = useRouter();
  const [s, setS] = React.useState<Settings>(initial);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<"saved" | "error" | "test" | null>(null);
  const [mfa, setMfa] = React.useState(false); // the save needs the authenticator app (the API asks the owner for the second factor)
  const set = (p: Partial<Settings>) => {
    setNote(null);
    setS((x) => ({ ...x, ...p }));
  };
  const nameOk = validName(s.name);
  const hoursOk = s.hours.from < s.hours.to && s.hours.days.length > 0;
  const rangeOk = s.hours.from >= HOURS.min && s.hours.to <= HOURS.max && [s.hours.from, s.hours.to].every((h) => Number(h.slice(3, 5)) % HOURS.stepMinutes === 0);
  const toggleDay = (d: Day) => set({ hours: { ...s.hours, days: s.hours.days.includes(d) ? s.hours.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || s.hours.days.includes(x)) } });
  const line = sayLine(s.lang, s.style, s.name.trim() || initial.name, shop);
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
                <p className="text-sm text-muted">{t("asst.name.d", { name: s.name.trim() || initial.name, shop })}</p>
              </div>
              <label htmlFor="asst-name" className="sr-only">{t("asst.name.label")}</label>
              <input id="asst-name" value={s.name} maxLength={NAME_MAX} onChange={(e) => set({ name: e.target.value })} aria-invalid={!nameOk} aria-describedby={nameOk ? undefined : "asst-name-err"} className={`${fieldInput} max-w-xs`} />
              {nameOk ? null : (
                <p id="asst-name-err" role="alert" className="text-sm font-medium text-red-text">
                  {t("asst.name.err", { n: NAME_MAX })}
                </p>
              )}
            </section>

            <section className={block} aria-labelledby="asst-voice-h">
              <div>
                <h3 id="asst-voice-h" className="text-[17px] font-semibold">{t("asst.voice.t")}</h3>
                <p className="text-sm text-muted">{t("asst.voice.d")}</p>
              </div>
              <div role="radiogroup" aria-labelledby="asst-voice-h" className="grid gap-2.5 sm:grid-cols-2">
                {VOICES.map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={s.voice === v} onClick={() => set({ voice: v })} className={opt(s.voice === v)}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <strong className="text-[15px]">{voiceNames[v]}</strong>
                      <span className="text-[13px] text-muted">{t(`asst.voice.${v}.d` as "asst.voice.female_warm.d")}</span>
                    </span>
                  </button>
                ))}
              </div>
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
            <strong className="text-lg">{t("asst.preview.who", { name: s.name.trim() || initial.name })}</strong>
            <span className="text-[13px] opacity-80">
              {voiceNames[s.voice]} · {t(`asst.style.${s.style}` as "asst.style.warm")} · {s.speed.toFixed(2).replace(/0$/, "")}×
            </span>
          </div>
          <p lang={s.lang} data-part="preview-line" className="m-0 text-center text-[17px] leading-relaxed">
            “{line}”
          </p>
          <button type="button" disabled className={`${btnQuiet} !border-white/30 !bg-transparent !text-on-charcoal opacity-60`}>
            ▶ {t("asst.hear")}
          </button>
          <p className="text-center text-xs opacity-80">{t("asst.hear.soon")}</p>
          <button type="button" disabled={!canEdit} onClick={() => setNote("test")} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 text-[15px] font-bold text-ink disabled:opacity-60">
            {t("asst.test")}
          </button>
          <p className="text-center text-xs opacity-80">{note === "test" ? t("asst.test.soon") : t("asst.test.note")}</p>
        </aside>
      </div>
    </div>
  );
}
