"use client";

import * as React from "react";

import type { TestCall, TestCallResult } from "@/lib/assistant/test-call";

import { alertBox, btnMain, mutedText, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Step 5 of the Lead Desk setup, "Try a test call" (night 4, part A2): a SIMULATION until telephony exists. It shows what the assistant would say to a customer, in the language and voice chosen in the step before, and what it would
 * record. No call is made and nothing is sent or stored; a real test call to your own phone comes with AI calls.
 */
export function WizardTestCall({ words, run, canRun, lang }: { words: Words; run: () => Promise<TestCallResult>; canRun: boolean; lang: string }) {
  const t = makeT(words);
  const [state, setState] = React.useState<{ s: "idle" } | { s: "running" } | { s: "failed" } | { s: "done"; call: TestCall }>({ s: "idle" });
  return (
    <div data-part="wizard-test-call" className={`${surface} flex flex-col gap-3`}>
      <p className="text-base">{t("asst.test.note")}</p>
      <div>
        <button
          type="button"
          className={btnMain}
          disabled={!canRun || state.s === "running"}
          onClick={async () => {
            setState({ s: "running" });
            const r = await run().catch((): TestCallResult => ({ ok: false, error: "not_available" }));
            setState(r.ok ? { s: "done", call: r.call } : { s: "failed" });
          }}
        >
          {t("asst.test")}
        </button>
      </div>
      {!canRun ? <p className={`${mutedText} !mt-0`}>{t("ld.wiz.s5.owner")}</p> : null}
      {state.s === "running" ? <p role="status">{t("asst.test.running")}</p> : null}
      {state.s === "failed" ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {t("asst.test.err")}
        </p>
      ) : null}
      {state.s === "done" ? (
        <div role="status" className="rounded-xl border border-line p-3">
          <h3 className="font-display text-lg font-bold">{t("asst.test.title")}</h3>
          <p className={`${mutedText} !mt-1`}>{state.call.note}</p>
          <ol className="mt-2 flex flex-col gap-2">
            {state.call.transcript.map((row, i) => (
              <li key={i} lang={lang} className="text-base">
                <span className="font-semibold">{t(`asst.test.who.${row.speaker}` as "asst.test.who.assistant")}: </span>
                {row.text}
              </li>
            ))}
          </ol>
          {state.call.outcome ? <p className="mt-2 font-semibold">{t("asst.test.outcome", { reason: state.call.outcome.reason })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
