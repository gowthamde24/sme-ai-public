"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Sheet } from "../sheet/Sheet";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, help, primary, quiet, secondary } from "../visits/styles";

export type VoidAction = (entryId: string) => Promise<{ ok: true } | { ok: false; error: string }>;

/** "Void this entry" with a confirmation (Owner and Admin): an entry is never changed or deleted; a mistake is voided once, and the account is worked out again without it. */
export function EntryVoid({ entryId, words, voidEntry }: { entryId: string; base: string; words: TodayWords; voidEntry: VoidAction }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  async function go() {
    setBusy(true);
    setProblem(null);
    const out = await voidEntry(entryId);
    setBusy(false);
    if (!out.ok) return setProblem(out.error);
    setOpen(false);
    router.refresh();
  }
  return (
    <>
      <button type="button" className={secondary} onClick={() => setOpen(true)}>{say(words, "due.void")}</button>
      <Sheet open={open} onClose={() => !busy && setOpen(false)} busy={busy} id={`void-${entryId}`} title={say(words, "due.void.title")} closeLabel={say(words, "today.act.cancel")}>
        <p className="text-base">{say(words, "due.void.body")}</p>
        <p className={help}>{say(words, "due.void.note")}</p>
        {problem ? <p role="alert" className={errorLine}>{problem}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" data-autofocus className={primary} disabled={busy} onClick={() => void go()}>{busy ? say(words, "today.act.working") : say(words, "due.void.go")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => setOpen(false)}>{say(words, "today.act.cancel")}</button>
        </div>
      </Sheet>
    </>
  );
}
