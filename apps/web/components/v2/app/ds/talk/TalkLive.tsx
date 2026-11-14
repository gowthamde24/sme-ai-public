"use client";

import * as React from "react";

import { Orb, type OrbState } from "@/components/v2/Orb";

import { todayInIndia } from "@/components/v2/app/visits/dates";
import { formatWhen } from "@/lib/conversation/format-when";

import { btnMain, btnQuiet } from "../../ui";
import { makeT, type Words } from "../../words";
import { pieces, type TalkLine, type TalkPlan, type TalkState } from "./script";
import { BigFigures, PlanExtraLines, SecondStep, usePlanStep } from "./PlanBig";
import { clock, type TalkLive as Live } from "./use-talk-live";

const stateWordOf = (live: Live, t: ReturnType<typeof makeT>): string => (live.connecting ? t("dst.connecting.label") : live.muted ? t("dst.muted.label") : t(live.state === "speaking" ? "dst.speaking" : live.state === "thinking" ? "dst.thinking" : "dst.listening"));
const ORB: Record<TalkState, OrbState> = { listening: "listen", thinking: "think", speaking: "speak" };

/** A line with its numbers, ₹ amounts and times in orange. */
function Line({ text }: { text: string }) {
  return (
    <>
      {pieces(text).map((p, i) =>
        p.key ? (
          <mark key={i} className="bg-transparent font-semibold text-brand-text">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}


/** Five sound bars. With an analyser (the real conversation) they follow its loudness, written straight to the elements so a render is not needed 60 times a second; without one (a made-up conversation, or reduced motion) they move or stand as the stylesheet says. */
export function LevelBars({ analyser }: { analyser: AnalyserNode | null | undefined }) {
  const box = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const el = box.current;
    if (!el || !analyser || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bars = Array.from(el.children) as HTMLElement[];
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const rms = Math.min(1, Math.sqrt(sum / data.length) * 4);
      bars.forEach((b, i) => {
        b.style.animation = "none";
        b.style.height = `${Math.round(5 + 17 * Math.min(1, rms * (0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 180 + i * 1.3)))))}px`;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      bars.forEach((b) => {
        b.style.animation = "";
        b.style.height = "";
      });
    };
  }, [analyser]);
  return (
    <span ref={box} data-part="level-bars" data-follows={analyser ? "sound" : "style"} className="ds-bars" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

/** What a real plan says about itself, from the numbers the API gave (a made-up plan has none of these: its own three fields are drawn). */
function planFacts(plan: TalkPlan, t: ReturnType<typeof makeT>): string[] {
  return [
    plan.people != null ? t("bv.chat.plan.people", { n: plan.people }) : null,
    plan.messages ? t("bv.chat.plan.messages", { n: plan.messages }) : null,
    plan.minutes ? t("bv.chat.plan.minutes", { n: plan.minutes }) : null,
    plan.channel ? t(`bv.chat.plan.${plan.channel}`) : null,
    plan.cost ? plan.cost : null,
  ].filter((v): v is string => v !== null);
}
const isReal = (plan: TalkPlan) => plan.people !== undefined;

/** The first button of a plan card says what it will do (the owner's words: "సరే, కాల్ చెయ్యి" for a calling plan, "సరే, పంపు" for messages, "సరే, చెయ్యి" otherwise). */
const yesKeyOf = (plan: TalkPlan): string => (plan.channel === "call" ? "dst.yes_call" : plan.channel === "whatsapp" ? "dst.yes_send" : "dst.yes_start");

/** The time phrase of a plan (from the API's structured `when`), written in the language the plan came in, which is the conversation's. Nothing when the API gave no time. */
function PlanWhenLine({ plan }: { plan: TalkPlan }) {
  const [today] = React.useState(() => todayInIndia(Date.now()));
  if (!plan.when) return null;
  return (
    <p data-part="plan-when" className="mt-1 text-sm font-semibold text-brand-text">
      {formatWhen(plan.when, plan.language, today)}
    </p>
  );
}

/** What the assistant is doing while it thinks, in the conversation's language (the API sends only a code). */
function StepLine({ live, t }: { live: Live; t: ReturnType<typeof makeT> }) {
  if (!live.step) return null;
  return (
    <p role="status" data-part="talk-step" data-step={live.step} className="mt-2 text-sm text-muted">
      {t(`dst.step.${live.step}`)}
    </p>
  );
}

/** The sentence for a failed turn's code, in the conversation's language: one key per code the API sends (error-codes.md); any other code is the general "that did not work". */
const TURN_ERROR: Readonly<Record<string, string>> = {
  ai_paused_until: "dst.err.paused",
  mfa_required: "dst.err.mfa",
  action_expired: "dst.err.expired",
  action_state: "dst.err.state",
  forbidden: "dst.err.forbidden",
  not_available: "dst.err.unavailable",
};

/** The line under the transcript of a real conversation: why it stopped (in plain words, with "Try again" where that helps), or the gentle notices. Never nothing. */
function Notes({ live, t }: { live: Live; t: ReturnType<typeof makeT> }) {
  const p = live.problem;
  const stopped = p
    ? p.kind === "connect"
      ? t("dst.err.connect")
      : p.kind === "lost"
        ? t("dst.err.lost")
        : p.kind === "mic"
          ? t("dst.err.mic")
          : p.word === "session"
            ? t("dst.end.session")
            : t(`bv.end.${p.word ?? "unavailable"}`)
    : null;
  return (
    <>
      {live.connecting ? (
        <p role="status" data-part="talk-connecting" className="mt-2 text-sm text-muted">
          {t("dst.connecting")}
        </p>
      ) : null}
      {p && stopped ? (
        <p role="alert" data-part="talk-problem" data-kind={p.kind} className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-red-text">
          <span>{stopped}</span>
          {p.retry && live.retry ? (
            <>
              {p.kind === "connect" ? <span aria-hidden="true">·</span> : null}
              <button type="button" onClick={live.retry} data-part="talk-retry" className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 font-bold text-ink hover:bg-surface-2">
                {t("dst.err.retry")}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {live.turnProblem && !p ? (
        <p role="status" data-part="talk-turn-problem" data-code={live.turnProblem} className="mt-2 text-sm font-medium text-red-text">
          {t(TURN_ERROR[live.turnProblem] ?? "dst.err.turn")}
        </p>
      ) : null}
      {live.muted && !p ? (
        <p role="status" data-part="talk-muted" className="mt-2 text-sm text-muted">
          {t("dst.muted")}
        </p>
      ) : null}
      {live.notice && !p ? (
        <p role="status" data-part="talk-notice" className="mt-2 text-sm text-muted">
          {live.notice.kind === "checkin" ? t("bv.live.checkin", { n: live.notice.seconds }) : t("bv.live.timer", { time: clock(live.notice.seconds) })}
        </p>
      ) : null}
    </>
  );
}

/** What the plan card says once the owner (or a spoken "yes") has answered, and a refusal of the tap. A made-up conversation keeps its two example lines. */
function PlanAnswered({ live, t }: { live: Live; t: ReturnType<typeof makeT> }) {
  if (live.real) {
    const status = live.planStatus ?? "proposed";
    return (
      <p role="status" data-part="talk-answer" className="text-sm font-semibold text-brand-text">
        {t(`bv.chat.state.${status}`)}
      </p>
    );
  }
  return (
    <p role="status" data-part="talk-answer" className="text-sm font-semibold text-brand-text">
      {t(live.answer === "yes" ? "dst.answer_yes" : "dst.answer_change")}
    </p>
  );
}
const waiting = (live: Live) => (live.real ? (live.planStatus ?? "proposed") === "proposed" : live.answer === null);

/**
 * "Talk live" in place (design system v6): what the command bar shows while it is a live conversation. The real circle (components/v2/Orb) follows the state; a red timer under it; the label "LIVE WITH YOUR ASSISTANT · SPEAKING/LISTENING"; the transcript streams here (the owner's lines small and grey,
 * the assistant's larger, the key numbers in orange); a plan card appears inside with "Yes, start" and "Change". `controls` is the second row: moving sound bars with "Just talk. Interrupt any time.", the language, Mute, Type, End. Voice is mocked on staging (`mock`).
 */
export function TalkLiveBody({ live, words, language, onType, mock = !live.real, afterLine = null, variant = "card" }: { live: Live; words?: Words; language: string; onType: () => void; mock?: boolean; /** `bar` = inside Today's composer (the final design): the label with a red timer, YOU and YOUR ASSISTANT, the plan card and the control row; the orb is outside. */ variant?: "card" | "bar"; /** Something under a line of the transcript (My assistant: "Teach this" under the assistant's answers); null = nothing */ afterLine?: ((line: TalkLine, index: number) => React.ReactNode) | null }) {
  const t = makeT(words);
  const step = usePlanStep(live);
  if (variant === "bar") return <BarBody live={live} t={t} language={language} onType={onType} mock={mock} />;
  const stateWord = stateWordOf(live, t);
  return (
    <div data-part="talk-live" data-talk-state={live.state} className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <Orb px={72} state={ORB[live.state]} halo analyser={live.analyser ?? null} />
          <span data-part="talk-timer" className="font-mono text-sm font-semibold tabular-nums text-red-text">
            {clock(live.seconds)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p data-part="talk-label" className="text-xs font-bold tracking-wider text-red-text">
            <span aria-hidden="true">● </span>
            {t("dst.live_with")} · {stateWord}
          </p>
          <div aria-live="polite" className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
            {live.lines.map((l, i) => (
              <div key={i}>
                <p data-who={l.who} className={l.who === "owner" ? "text-sm text-muted" : "text-xl font-medium leading-snug"}>
                  <Line text={l.text} />
                  {l.cut ? <em className="ml-2 text-xs font-medium not-italic text-muted">{t("bv.live.interrupted")}</em> : null}
                </p>
                {afterLine ? afterLine(l, i) : null}
              </div>
            ))}
          </div>
          <StepLine live={live} t={t} />
          <Notes live={live} t={t} />
          {live.plan ? (
            <div data-part="talk-plan" className="mt-3 rounded-xl border border-brand-edge bg-brand-bg p-3">
              {isReal(live.plan) ? (
                <>
                  <p className="text-sm font-bold">{live.plan.what}</p>
                  {live.plan.summary ? <p className="mt-1 text-sm text-muted">{live.plan.summary}</p> : null}
                  {step.big ? <BigFigures plan={live.plan} t={t} /> : <p className="mt-1 text-sm text-muted">{planFacts(live.plan, t).join(" · ")}</p>}
                  {step.big ? <p className="mt-1 text-sm text-muted">{planFacts(live.plan, t).filter((f) => f !== live.plan?.cost).join(" · ")}</p> : null}
                  <PlanWhenLine plan={live.plan} />
                  <PlanExtraLines plan={live.plan} t={t} />
                </>
              ) : (
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  {(
                    [
                      ["dst.plan.what", live.plan.what],
                      ["dst.plan.time", live.plan.time],
                      ["dst.plan.cost", live.plan.cost],
                      ["dst.plan.hours", live.plan.hours],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="shrink-0 text-muted">{t(k)}</dt>
                      <dd className="font-semibold">
                        <Line text={v} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {waiting(live) && step.confirming ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <SecondStep plan={live.plan} t={t} step={step} busy={!!live.planBusy} />
                </div>
              ) : waiting(live) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={live.planBusy} onClick={step.onYes} className={btnMain}>
                    {t(yesKeyOf(live.plan))}
                  </button>
                  <button type="button" disabled={live.planBusy} onClick={() => live.decide("change")} className={btnQuiet}>
                    {t("dst.change")}
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <PlanAnswered live={live} t={t} />
                </div>
              )}
              {live.planError ? (
                <p role="alert" data-part="talk-plan-error" className="mt-2 text-sm font-medium text-red-text">
                  {t(live.planError)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div data-part="talk-controls" className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <LevelBars analyser={live.analyser} />
        <span className="min-w-0 flex-1 text-sm text-muted">{t("dst.just_talk")}</span>
        {live.real && live.state === "speaking" && live.bargeIn ? (
          <button type="button" onClick={live.bargeIn} data-part="talk-interrupt" className={btnQuiet}>
            {t("dst.interrupt")}
          </button>
        ) : null}
        <span className="rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm font-semibold" data-part="talk-language">
          {language} ▾
        </span>
        <button type="button" aria-pressed={live.muted} onClick={live.toggleMute} className={btnQuiet}>
          {t(live.muted ? "dst.unmute" : "dst.mute")}
        </button>
        <button type="button" onClick={onType} className={btnQuiet}>
          {t("dst.type")}
        </button>
        <button type="button" onClick={live.end} className="inline-flex min-h-11 items-center rounded-lg bg-red-text px-4 text-sm font-semibold text-bg">
          {t("dst.end")}
        </button>
      </div>
      {mock ? <p className="text-xs text-muted">{t("dst.mock")}</p> : null}
    </div>
  );
}

/** The live conversation as Today's composer draws it (the final design): inside the glass box, the label with a red timer, YOU and YOUR ASSISTANT, the plan card and the control row. The orb is OUTSIDE the box and follows the conversation. Same state and lines as the card; only the layout differs. */
function BarBody({ live, t, language, onType, mock }: { live: Live; t: ReturnType<typeof makeT>; language: string; onType: () => void; mock: boolean }) {
  const step = usePlanStep(live);
  const stateWord = stateWordOf(live, t);
  return (
    <div data-part="talk-live" data-variant="bar" data-talk-state={live.state}>
      <div className="px-[22px] pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p data-part="talk-label" className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-red-text">
            <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-red-text align-[1px] shadow-[0_0_0_4px_rgba(251,113,133,0.2)]" />
            {t("dst.live_with")} · {stateWord}
          </p>
          <span data-part="talk-timer" className="inline-flex items-center gap-1 rounded-full bg-red-text px-2.5 py-0.5 font-mono text-[11.5px] font-extrabold tabular-nums text-bg">
            <span aria-hidden="true">●</span>
            {clock(live.seconds)}
          </span>
        </div>
        <div className="min-w-0">
          <div aria-live="polite" className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {live.lines.map((l, i) => (
              <div key={i} data-who={l.who}>
                {live.lines[i - 1]?.who !== l.who ? <small className="mb-0.5 block text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{t(l.who === "owner" ? "tv6.talk.you" : "tv6.talk.assistant")}</small> : null}
                <p className={l.who === "owner" ? "text-base leading-[1.45] text-muted" : "text-[19px] font-medium leading-[1.45] text-ink"}>
                  <Line text={l.text} />
                  {l.cut ? <em className="ml-2 text-xs font-medium not-italic text-muted">{t("bv.live.interrupted")}</em> : null}
                </p>
              </div>
            ))}
          </div>
          <StepLine live={live} t={t} />
          <Notes live={live} t={t} />
          {live.plan ? (
            <div data-part="talk-plan" className="mt-3 flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-surface-2 py-2.5 pl-3.5 pr-2.5">
              <span aria-hidden="true">📋</span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-bold">{live.plan.what}</p>
                {isReal(live.plan) ? (
                  <>
                    {live.plan.summary ? <p className="text-[12.5px] text-muted">{live.plan.summary}</p> : null}
                    {step.big ? <BigFigures plan={live.plan} t={t} /> : null}
                    <p className="text-[12.5px] text-muted">{planFacts(live.plan, t).filter((f) => !step.big || f !== live.plan?.cost).join(" · ")}</p>
                    <PlanWhenLine plan={live.plan} />
                    <PlanExtraLines plan={live.plan} t={t} />
                  </>
                ) : (
                  <p className="text-[12.5px] text-muted">
                    <Line text={live.plan.time} /> · <Line text={live.plan.cost} /> · {t("dst.plan.hours").toLowerCase()} <Line text={live.plan.hours} />
                  </p>
                )}
              </div>
              {waiting(live) && step.confirming ? (
                <SecondStep plan={live.plan} t={t} step={step} busy={!!live.planBusy} mainClass="inline-flex min-h-11 items-center rounded-[9px] border border-brand-edge bg-brand px-3.5 text-[13.5px] font-bold text-on-brand hover:brightness-95 disabled:opacity-60" quietClass="inline-flex min-h-11 items-center rounded-[9px] border border-line bg-surface px-3.5 text-[13.5px] font-bold text-ink hover:bg-surface-2 disabled:opacity-60" />
              ) : waiting(live) ? (
                <>
                  <button type="button" disabled={live.planBusy} onClick={step.onYes} className="inline-flex min-h-11 items-center rounded-[9px] border border-brand-edge bg-brand px-3.5 text-[13.5px] font-bold text-on-brand hover:brightness-95 disabled:opacity-60">
                    {t(yesKeyOf(live.plan))}
                  </button>
                  <button type="button" disabled={live.planBusy} onClick={() => live.decide("change")} className="inline-flex min-h-11 items-center rounded-[9px] border border-line bg-surface px-3.5 text-[13.5px] font-bold text-ink hover:bg-surface-2 disabled:opacity-60">
                    {t("dst.change")}
                  </button>
                </>
              ) : (
                <PlanAnswered live={live} t={t} />
              )}
              {live.planError ? (
                <p role="alert" data-part="talk-plan-error" className="basis-full text-sm font-medium text-red-text">
                  {t(live.planError)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div data-part="talk-controls" className="flex flex-wrap items-center gap-2.5 border-t border-line py-3 pl-5 pr-3.5">
        <LevelBars analyser={live.analyser} />
        <span className="min-w-0 flex-1 text-sm text-muted">{t("dst.just_talk")}</span>
        {live.real && live.state === "speaking" && live.bargeIn ? (
          <button type="button" onClick={live.bargeIn} data-part="talk-interrupt" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface-2 px-3.5 text-sm font-bold text-ink hover:bg-surface">
            {t("dst.interrupt")}
          </button>
        ) : null}
        <span className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink" data-part="talk-language">
          {language} <span className="text-muted">▾</span>
        </span>
        <button type="button" aria-pressed={live.muted} onClick={live.toggleMute} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface-2 px-3.5 text-sm font-bold text-ink hover:bg-surface">
          {t(live.muted ? "dst.unmute" : "dst.mute")}
        </button>
        <button type="button" onClick={onType} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface-2 px-3.5 text-sm font-bold text-ink hover:bg-surface">
          {t("dst.type")}
        </button>
        <button type="button" onClick={live.end} className="inline-flex min-h-11 items-center rounded-[14px] bg-red-text px-5 text-sm font-extrabold text-bg">
          {t("dst.end")}
        </button>
      </div>
      {mock ? <p className="px-5 pb-3 text-xs text-muted">{t("dst.mock")}</p> : null}
    </div>
  );
}
