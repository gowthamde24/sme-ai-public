"use client";

import { DictInput } from "../voice-input/Dictatable";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { searchTextProblem, type Search } from "@/lib/lead-finder/types";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, help, primary, type Failed, type Reply } from "../cc/kit";
import { makeT, type Words } from "../words";
import { PlanCard, ResultCard } from "./SearchCards";

export type FinderActions = {
  plan: (text: string) => Promise<Reply<Search>>;
  approve: (searchId: string) => Promise<Reply<Search>>;
  cancel: (searchId: string) => Promise<Reply<Search>>;
};

/**
 * The box on the Prospects tab (job lead-finder part D, contract sections 1 and 2): the owner's words ("find new retailers in Jayanagar") -> the PLAN CARD (what, where, at most how many, the cost, the searches left today) -> OK
 * (Owner, Admin) -> the RESULT CARD ("Found 18 · 0 call-ready · 11 need you · 7 skipped"). Nothing is searched before the OK; Cancel throws the plan away. A Sales member can plan and is told who can OK it.
 */
export function FinderBox({ words, canApprove, base, actions, initialText = "", onApproved }: { words: Words; canApprove: boolean; base: string; actions: FinderActions; /** The words already in the box (the demo video: it does not wait for typing). */ initialText?: string; /** After an OK: the page is read again (the default), or this instead (the demo video, which has no page to read). */ onApproved?: () => void }) {
  const t = makeT(words);
  const id = useId();
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [search, setSearch] = useState<Search | null>(null);

  async function run(step: () => Promise<Reply<Search>>, after?: (s: Search) => void) {
    setBusy(true);
    setFailure(null);
    let r: Reply<Search>;
    try {
      r = await step();
    } catch {
      r = { ok: false, kind: "unavailable", error: "" };
    }
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setSearch(r.data);
    after?.(r.data);
  }
  function plan() {
    const p = searchTextProblem(text);
    setProblem(p ? t(p === "empty" ? "lf.find.empty" : "lf.find.too_long") : null);
    if (p) return;
    void run(() => actions.plan(text.trim()));
  }

  return (
    <section className={card} aria-labelledby={`${id}-title`} data-finder="">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          plan();
        }}
      >
        <label id={`${id}-title`} htmlFor={`${id}-text`} className={`${h2} block`}>
          {t("lf.find.label")}
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <DictInput id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={t("lf.find.placeholder")} aria-describedby={`${id}-help`} className={`${field} min-w-0 flex-1 basis-56`} />
          <button type="submit" disabled={busy} className={`${primary} write-ctl`}>
            {busy && !search ? t("lf.working") : t("lf.find.btn")}
          </button>
        </div>
        <p id={`${id}-help`} className={help}>
          {t("lf.find.help")}
        </p>
        {problem ? (
          <p role="alert" className="text-sm font-medium text-red-text">
            {problem}
          </p>
        ) : null}
      </form>
      <FailureNote failure={failure} words={words} />
      {search?.state === "planned" ? <PlanCard search={search} words={words} canApprove={canApprove} busy={busy} onOk={() => void run(() => actions.approve(search.id), () => (onApproved ? onApproved() : router.refresh()))} onCancel={() => (canApprove ? void run(() => actions.cancel(search.id)) : setSearch(null))} /> : null}
      {search && search.state !== "planned" ? <ResultCard search={search} words={words} base={base} /> : null}
    </section>
  );
}
