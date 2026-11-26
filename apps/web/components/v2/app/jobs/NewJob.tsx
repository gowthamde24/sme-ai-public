"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { PLAN_TEXT_MAX, PLAN_TEXT_MIN, type JobPlan, type JobStarted, type JobTested, type PlanChannel, type PlanInput, type SearchPatch, type Suggestion } from "@/lib/jobs/plan";
import type { JobKind } from "@/lib/jobs/types";

import type { Reply } from "../cc/kit";
import { VoiceMic } from "../voice-input/VoiceMic";
import { makeT, type Words } from "../words";
import type { PlanCardState } from "./PlanCard";
import { PlanCard } from "./LazyPlanCard";
import { StartedToast } from "./StartedToast";
import { SuggestedJobs } from "./SuggestedJobs";

export type NewJobActions = {
  plan: (input: PlanInput) => Promise<Reply<JobPlan>>;
  start: (planId: string) => Promise<Reply<JobStarted>>;
  startSuggestion: (kind: JobKind) => Promise<Reply<JobStarted>>;
  test: (planId: string, channel: PlanChannel) => Promise<Reply<JobTested>>;
  /** A Lead Finder plan's three choices (`PATCH /jobs/plan/{id}`): only what changed; the whole plan answers. Absent = the choices are shown but not changeable. */
  search?: (planId: string, patch: SearchPatch) => Promise<Reply<JobPlan>>;
};

const EXAMPLES = ["jobs.new.example.silk", "jobs.new.example.missed"] as const;
const IDLE: PlanCardState = { starting: false, testing: false, swapping: false, searching: false, note: null, error: null, waiting: null, quiet: false };

/**
 * "Start a job" (JOBS; mock sheets 02 and 03): a box to say or type what the assistant should do, two examples, then the PLAN card; and below, the suggested jobs for this kind of business. Nothing starts until Start (on the plan card or on a suggested job) is pressed;
 * then the person lands on the job's page with a short "Started" toast. The microphone is the app's own voice typing (it puts the words in the box and sends nothing); it is simply not there where the browser or the workspace has no voice.
 */
export function NewJob({ words, base, actions, suggestions, heading, initialPlan }: { words: Words; base: string; actions: NewJobActions; suggestions: readonly Suggestion[]; /** the word of the heading (`jobs.new.sug.<heading>`), or null for the plain one */ heading: string | null; initialPlan: JobPlan | null }) {
  const t = makeT(words);
  const router = useRouter();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const planRef = useRef<HTMLHeadingElement>(null);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<JobPlan | null>(initialPlan);
  const [source, setSource] = useState<PlanInput | null>(initialPlan ? { text: initialPlan.title } : null);
  const [planning, setPlanning] = useState(false);
  const [boxError, setBoxError] = useState<string | null>(null);
  const [card, setCard] = useState<PlanCardState>(IDLE);
  const [started, setStarted] = useState(false);

  async function ask(input: PlanInput, swapping = false) {
    setBoxError(null);
    setPlanning(true);
    if (swapping) setCard((c) => ({ ...c, swapping: true, error: null }));
    const r = await actions.plan(input);
    setPlanning(false);
    setCard(IDLE);
    if (!r.ok) {
      setBoxError(r.error);
      return;
    }
    setPlan(r.data);
    setSource(input);
    // the plan is what the person looks at next: focus moves to its title (a screen reader reads it) without scrolling the page away from the box on a wide screen
    requestAnimationFrame(() => planRef.current?.focus({ preventScroll: false }));
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const said = text.trim();
    if (said.length < PLAN_TEXT_MIN || said.length > PLAN_TEXT_MAX) {
      setBoxError(t("jobs.new.err.text"));
      return;
    }
    void ask({ text: said });
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };
  function example(key: string) {
    const said = t(key);
    setText(said);
    void ask({ text: said });
  }

  async function start() {
    if (!plan) return;
    setCard((c) => ({ ...c, starting: true, error: null, note: null }));
    const r = await actions.start(plan.planId);
    if (!r.ok) {
      setCard((c) => ({ ...c, starting: false, error: r.error }));
      return;
    }
    // `409 approval_needed`: nothing is wrong, the Owner's OK comes first (it is in Needs you on Today)
    if ("approval" in r.data) {
      const waiting = r.data.approval.kind;
      setCard((c) => ({ ...c, starting: false, waiting }));
      return;
    }
    setStarted(true);
    router.push(`${base}/jobs/${r.data.jobId}?started=1`);
  }
  async function test() {
    if (!plan) return;
    const channel: PlanChannel = plan.says[0]?.channel ?? "call";
    setCard((c) => ({ ...c, testing: true, error: null, note: null }));
    const r = await actions.test(plan.planId, channel);
    if (!r.ok && r.code === "quiet_hours") {
      // a test call or message is only sent between 9 am and 9 pm: the button stays off and the line says why
      setCard((c) => ({ ...c, testing: false, quiet: true, note: t("jobs.job.test.quiet") }));
      return;
    }
    const sent = r.ok ? t(r.data.mock ? "jobs.new.test.mock" : channel === "call" ? "jobs.new.test.sent_call" : "jobs.new.test.sent_message") : "";
    const used = r.ok && !r.data.mock && r.data.minutesUsed > 0 ? ` ${t("jobs.job.test.used", { n: r.data.minutesUsed })}` : "";
    setCard((c) => ({ ...c, testing: false, ...(r.ok ? { note: `${sent}${used}` } : { error: r.error }) }));
  }
  function change() {
    if (!plan) return;
    setText(source && "text" in source ? source.text : plan.title);
    boxRef.current?.focus();
    boxRef.current?.scrollIntoView?.({ block: "center" });
  }
  /** A Lead Finder plan's choice: only what changed goes to `PATCH /jobs/plan/{id}`; the whole plan comes back (the same id). */
  async function search(patch: SearchPatch) {
    if (!plan || !actions.search) return;
    setCard((c) => ({ ...c, searching: true, error: null }));
    const r = await actions.search(plan.planId, patch);
    if (!r.ok) {
      setCard((c) => ({ ...c, searching: false, error: r.error }));
      return;
    }
    setPlan(r.data);
    setCard((c) => ({ ...c, searching: false }));
  }
  function swap() {
    const alt = plan?.alternatives.find((a) => a.kind === "whatsapp");
    if (!alt) return;
    if (plan) void ask({ as: "whatsapp", planId: plan.planId }, true);
  }

  const unclear = plan?.blockers.includes("unclear_who") === true;
  return (
    <div data-part="new-job" className="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-start md:gap-x-8">
      <div className="flex min-w-0 flex-col gap-4 md:col-start-1">
        <form onSubmit={submit} data-part="say" className="flex flex-col gap-2">
          <label htmlFor="job-say" className="text-[12px] font-bold uppercase tracking-wider text-muted">
            {t("jobs.new.label")}
          </label>
          <div className="rounded-xl border border-brand-edge bg-surface p-2 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-brand)_25%,transparent)]">
            <textarea
              ref={boxRef}
              id="job-say"
              name="job-say"
              rows={2}
              maxLength={PLAN_TEXT_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder={t("jobs.new.placeholder")}
              data-voice="allow"
              className="block w-full resize-none rounded-xl border-0 bg-transparent px-2 py-1.5 text-[16px] leading-snug text-ink outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-end gap-2">
              <VoiceMic target={boxRef} size="icon" />
              <button type="submit" aria-label={t("jobs.new.go")} disabled={planning} className="jb-press grid size-11 shrink-0 place-items-center rounded-md border border-brand-edge bg-brand text-on-brand disabled:opacity-60">
                <ArrowRight aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>
          {boxError ? (
            <p role="alert" className="m-0 text-sm text-red-text">
              {boxError}
            </p>
          ) : null}
          {planning ? (
            <p role="status" className="m-0 text-sm text-muted">
              {t("jobs.new.thinking")}
            </p>
          ) : null}
        </form>
        {unclear ? (
          <p role="status" data-part="plan-unclear" className="jb-enter m-0 rounded-xl bg-surface-2 px-4 py-3 text-[15px] leading-snug text-ink">
            {t("jobs.new.unclear")}
          </p>
        ) : null}
        <ul aria-label={t("jobs.new.examples")} className="m-0 flex list-none flex-wrap gap-2 p-0">
          {EXAMPLES.map((key) => (
            <li key={key}>
              <button type="button" data-example={key} disabled={planning} onClick={() => example(key)} className="jb-press relative inline-flex min-h-9 items-center rounded-md border border-line bg-surface-2 px-3.5 text-[13.5px] font-semibold text-ink before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']">
                {t(key)}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {plan && !unclear ? (
        <div className="min-w-0 md:sticky md:top-4 md:col-start-2 md:row-span-2 md:row-start-1">
          <PlanCard plan={plan} words={words} base={base} state={card} onStart={() => void start()} onSwap={swap} onChange={change} onTest={() => void test()} onSearch={actions.search ? (patch) => void search(patch) : undefined} headingRef={planRef} />
        </div>
      ) : null}
      <div className="min-w-0 md:col-start-1">
        {suggestions.length > 0 ? (
          <section aria-labelledby="sug-title" data-part="suggested" className="flex flex-col gap-3">
            <div>
              <h2 id="sug-title" className="m-0 font-display text-[20px] font-bold leading-tight text-ink">
                {t(heading && words[`jobs.new.sug.${heading}`] ? `jobs.new.sug.${heading}` : "jobs.new.sug.title")}
              </h2>
              <p className="m-0 mt-1 text-[14px] leading-snug text-muted">{t("jobs.new.sug.sub")}</p>
            </div>
            <SuggestedJobs suggestions={suggestions} words={words} base={base} actions={{ start: actions.startSuggestion }} onLook={(kind) => void ask({ kind })} />
          </section>
        ) : null}
      </div>
      {started ? <StartedToast label={t("jobs.new.started")} /> : null}
    </div>
  );
}
