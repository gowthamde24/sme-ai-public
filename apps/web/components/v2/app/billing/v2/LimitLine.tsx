"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { formatRupeesShort } from "@/lib/money";

import { Choose, Sentence } from "../../jobs/rules/parts";
import { makeT, type Words } from "../../words";

type Result = { ok: true } | { ok: false; error: string };

/**
 * One optional spending limit as a plain sentence with the choice inside: "Stop calls for this month after [₹2,000 v]" (the sentence is `bill.limit.*`, the amounts are the choices). A choice is saved at once (an Owner or Admin, the page's server action);
 * a failed save puts the old choice back and says so (the page keys this part by the saved limit, so a new saved value starts it afresh). "No limit" is the first choice. A limit already set that the list does not hold is added to it, so what is saved always shows.
 */
export function LimitLine({ words, sentence, feature, valuePaise, choices, setLimit, disabled }: { words: Words; sentence: "bill.limit.calls" | "bill.limit.find" | "bill.limit.wa"; feature: string; valuePaise: number | null; choices: readonly number[]; setLimit: (feature: string, paise: number | null) => Promise<Result>; disabled: boolean }) {
  const t = makeT(words);
  const router = useRouter();
  const [value, setValue] = React.useState<string>(valuePaise === null ? "none" : String(valuePaise));
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = React.useTransition();
  const options = ["none", ...choices.map(String)];
  const text = (v: string) => (v === "none" ? t("bill.limit.none") : formatRupeesShort(Number(v)));
  const change = (next: string) => {
    const before = value;
    setValue(next);
    setNote(null);
    start(async () => {
      const out = await setLimit(feature, next === "none" ? null : Number(next)).catch((): Result => ({ ok: false, error: t("bill.limit.err") }));
      if (out.ok) {
        setNote({ ok: true, text: t("bill.limit.saved") });
        router.refresh();
      } else {
        setValue(before);
        setNote({ ok: false, text: out.error });
      }
    });
  };
  return (
    <div data-part="limit" data-feature={feature}>
      <Sentence template={t(sentence)} line={`limit-${feature}`} parts={{ limit: (aria) => <Choose aria={aria} value={value} options={options} text={text} disabled={disabled || busy} onChange={change} /> }} />
      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`m-0 text-sm font-semibold ${note.ok ? "text-green-text" : "text-red-text"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
