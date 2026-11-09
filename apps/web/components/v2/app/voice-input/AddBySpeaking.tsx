"use client";

import * as React from "react";

import { NO_FRAME_DATA } from "../contract";
import { useFrameData } from "../frame-store";
import { word } from "../labels";
import { AskVoiceContext } from "../today/ask/ask-store";
import { VoiceInputOptionsContext, canDictate } from "./use-voice-input";
import { VoiceMic } from "./VoiceMic";

type Step = "q" | "a" | "review" | "edit";

/**
 * "Add by speaking" (owner decision, 9 Nov 2026, Train how it talks): the guided way to add a question and its answer without typing. Step 1 "Say the question a customer asks", step 2 "Now say your answer"; then both are shown as
 * text with Save / Say again / Edit. Nothing is saved until Save is pressed; the words are the person's to correct (Edit) before that. It is drawn only where voice typing is possible (app v4, the workspace's voice on, a browser that can
 * record); otherwise nothing is drawn and the typing fields are all there is. `onSave` gets the two texts.
 */
export function AddBySpeaking({ onSave, maxQ, maxA, disabled = false }: { onSave: (question: string, answer: string) => void; maxQ: number; maxA: number; disabled?: boolean }) {
  const v4 = useFrameData(NO_FRAME_DATA).v4 === true;
  const voice = React.useContext(AskVoiceContext);
  const labels = voice?.words;
  const given = React.useContext(VoiceInputOptionsContext);
  const browser = React.useSyncExternalStore(
    () => () => undefined,
    canDictate,
    () => false,
  );
  const can = given.supported ?? browser;
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("q");
  const [q, setQ] = React.useState("");
  const [a, setA] = React.useState("");
  const qRef = React.useRef<HTMLTextAreaElement>(null);
  const aRef = React.useRef<HTMLTextAreaElement>(null);
  const w = (key: string, english: string, vars?: Record<string, string>) => word(labels, key, english, vars);
  if (!v4 || !voice || !can || disabled) return null;
  const close = () => {
    setOpen(false);
    setStep("q");
    setQ("");
    setA("");
  };
  const field = "block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-base text-ink";
  const primary = "inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-on-brand disabled:opacity-50";
  const quiet = "inline-flex min-h-11 items-center justify-center rounded-full border border-edge px-5 text-base font-semibold text-ink";
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-part="add-by-speaking" className={`${quiet} mt-2 max-sm:w-full`}>
        {w("vi.add", "Add by speaking")}
      </button>
    );
  }
  return (
    <section aria-label={w("vi.add", "Add by speaking")} data-part="add-by-speaking-open" data-step={step} className="mt-3 flex flex-col gap-3 rounded-2xl border border-brand-edge bg-surface p-4">
      {step === "q" || step === "a" ? (
        <>
          <p className="m-0 text-sm font-semibold text-muted">{w("vi.add.step", "Step {n} of 2", { n: step === "q" ? "1" : "2" })}</p>
          <label htmlFor={`vi-${step}`} className="font-display text-lg font-bold">
            {step === "q" ? w("vi.add.q", "Say the question a customer asks") : w("vi.add.a", "Now say your answer")}
          </label>
          <textarea data-voice="allow" key={step} id={`vi-${step}`} ref={step === "q" ? qRef : aRef} rows={3} maxLength={step === "q" ? maxQ : maxA} value={step === "q" ? q : a} onChange={(e) => (step === "q" ? setQ(e.target.value) : setA(e.target.value))} className={field} />
          <VoiceMic target={step === "q" ? qRef : aRef} size="big" focused />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep(step === "q" ? "a" : "review")} disabled={(step === "q" ? q : a).trim() === ""} className={`${primary} max-sm:w-full`}>
              {w("vi.add.next", "Next")}
            </button>
            <button type="button" onClick={close} className={`${quiet} max-sm:w-full`}>
              {w("vi.add.cancel", "Cancel")}
            </button>
          </div>
        </>
      ) : null}
      {step === "review" ? (
        <>
          <p className="m-0 font-display text-lg font-bold">{w("vi.add.review", "Check it, then save")}</p>
          <dl className="m-0 flex flex-col gap-2 text-base">
            <div>
              <dt className="text-sm font-semibold text-muted">{w("vi.add.q.label", "The customer's question")}</dt>
              <dd className="m-0 [overflow-wrap:anywhere]" data-part="review-q">
                {q}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-muted">{w("vi.add.a.label", "Your answer")}</dt>
              <dd className="m-0 [overflow-wrap:anywhere]" data-part="review-a">
                {a}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(q.trim(), a.trim());
                close();
              }}
              className={`${primary} max-sm:w-full`}
              data-part="save"
            >
              {w("vi.add.save", "Save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setQ("");
                setA("");
                setStep("q");
              }}
              className={`${quiet} max-sm:w-full`}
            >
              {w("vi.add.again", "Say again")}
            </button>
            <button type="button" onClick={() => setStep("edit")} className={`${quiet} max-sm:w-full`}>
              {w("vi.add.edit", "Edit")}
            </button>
          </div>
        </>
      ) : null}
      {step === "edit" ? (
        <>
          <label htmlFor="vi-edit-q" className="text-sm font-semibold text-muted">
            {w("vi.add.q.label", "The customer's question")}
          </label>
          <textarea data-voice="allow" id="vi-edit-q" ref={qRef} rows={2} maxLength={maxQ} value={q} onChange={(e) => setQ(e.target.value)} className={field} />
          <VoiceMic target={qRef} size="wide" focused />
          <label htmlFor="vi-edit-a" className="text-sm font-semibold text-muted">
            {w("vi.add.a.label", "Your answer")}
          </label>
          <textarea data-voice="allow" id="vi-edit-a" ref={aRef} rows={3} maxLength={maxA} value={a} onChange={(e) => setA(e.target.value)} className={field} />
          <VoiceMic target={aRef} size="wide" focused />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep("review")} disabled={q.trim() === "" || a.trim() === ""} className={`${primary} max-sm:w-full`}>
              {w("vi.add.next", "Next")}
            </button>
            <button type="button" onClick={close} className={`${quiet} max-sm:w-full`}>
              {w("vi.add.cancel", "Cancel")}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
