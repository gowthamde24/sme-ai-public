"use client";

import { ArrowRight, ChevronDown, ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { PLAN_TEXT_MAX, PLAN_TEXT_MIN, type JobPlan, type PlanChannel, type PlanInput, type SearchPatch } from "@/lib/jobs/plan";
import { forSeason, groupByGoal, popularOf, textIn, type JobTemplate, type PackJobs, type SheetLoad, type TemplateSeason } from "@/lib/jobs/templates";

import { Skeleton } from "../../ds/Skeleton";
import { VoiceMic } from "../../voice-input/VoiceMic";
import { makeT, type Words } from "../../words";
import { PlanCard } from "../LazyPlanCard";
import { SampleChip } from "../SampleChip";
import type { PlanCardState } from "../PlanCard";
import { StartedToast } from "../StartedToast";
import { KIND_ICON, TemplateCard, type CardContext } from "./TemplateCard";
import type { SheetActions } from "./types";

const IDLE: PlanCardState = { starting: false, testing: false, swapping: false, searching: false, note: null, error: null, waiting: null, quiet: false };
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

type Loaded = { state: "loading" } | { state: "ready"; load: SheetLoad | null } | { state: "failed"; error: string };

/**
 * THE NEW JOB SHEET (owner 19 Nov, mock r3-01): one sheet opened by the "New job" button on Today and on the Jobs page, a bottom sheet on the phone and a side panel from 768 px. From the top: "Tell your assistant what you want done" (the box and the app's own
 * microphone), "Popular for <business type>" (live preview cards), "More ideas" by goal (Answer every enquiry, Bring customers back, Fill your visits, Find new customers; "Get paid" is later and never shown), and "Ideas from other businesses".
 * Saying or typing a sentence shows the plan card below the box (the same `PlanCard`); a card's "Use this" asks for the plan of the card's own sentence exactly as if it had been typed. Nothing starts before Start. This is its own lazy chunk: the pages that open it ship only the button.
 */
export default function NewJobSheet({ words, base, actions, onClose, initial, initialAsk = null, initialTemplate = null, initialSeason = null }: { words: Words; base: string; actions: SheetActions; onClose: () => void; /** data the server already read (`?new=1`); undefined = read it now */ initial?: SheetLoad | null; /** open on this card's plan (the empty Jobs page) */ initialAsk?: string | null; /** the id of that card's template: with it the real planner is asked for the template, not for the words */ initialTemplate?: string | null; /** open on the plan of the template of this festival season (the Today suggestion) */ initialSeason?: TemplateSeason | null }) {
  const t = makeT(words);
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const planRef = useRef<HTMLHeadingElement>(null);
  const [loaded, setLoaded] = useState<Loaded>(initial !== undefined ? { state: "ready", load: initial } : { state: "loading" });
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<JobPlan | null>(null);
  const [source, setSource] = useState<PlanInput | null>(null);
  const [planning, setPlanning] = useState(false);
  const [boxError, setBoxError] = useState<string | null>(null);
  const [card, setCard] = useState<PlanCardState>(IDLE);
  const [started, setStarted] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const [openGoal, setOpenGoal] = useState<string | null>(null);
  const [openIdea, setOpenIdea] = useState<string | null>(null);
  const autoAsked = useRef(false);

  const load = loaded.state === "ready" ? loaded.load : null;
  const lang = load?.lang ?? "en";
  const ctx: CardContext = {
    lang,
    business: load?.business ?? "",
    assistant: load?.assistant ?? t("jobs.tpl.sample.assistant"),
    item: (load?.data.sampleItem ? textIn(load.data.sampleItem, lang) : null) ?? t("jobs.tpl.sample.item"),
    customer: t("jobs.tpl.sample.customer"),
    businessLang: load?.businessLang ?? null,
  };
  const own = load?.data.own ?? null;
  const popular = useMemo(() => (own ? popularOf(own) : []), [own]);
  const otherSet: { name: string; jobs: PackJobs } | null = useMemo(() => {
    const o = load?.data.others.find((x) => x.pack === other);
    return o ? { name: textIn(o.name, lang), jobs: o.jobs } : null;
  }, [load, other, lang]);
  const ideaSet: PackJobs | null = otherSet?.jobs ?? own;
  const groups = useMemo(() => (ideaSet ? groupByGoal(ideaSet) : []), [ideaSet]);
  const typeName = load ? textIn(load.data.businessType.name, lang) : null;

  // read the ideas now unless the server gave them
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    void actions.load().then((r) => {
      if (!live) return;
      setLoaded(r.ok ? { state: "ready", load: r.data } : { state: "failed", error: r.error });
    });
    return () => {
      live = false;
    };
  }, [actions, initial]);

  // the dialog: focus, Escape, Tab stays inside, the page behind does not scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function ask(input: PlanInput, swapping = false) {
    if ("text" in input) setText(input.text);
    else if ("templateId" in input) setText(input.ask);
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
    setIdeasOpen(false);
    requestAnimationFrame(() => planRef.current?.focus({ preventScroll: false }));
  }

  // opened on a card's sentence (empty Jobs page) or on a festival: the plan is asked for once, as if it had been typed
  useEffect(() => {
    if (autoAsked.current || loaded.state !== "ready") return;
    const fromSeason = initialSeason && load ? forSeason(load.data.own, initialSeason) : null;
    const said = initialAsk ?? (fromSeason ? textIn(fromSeason.ask, lang) : null);
    if (!said) return;
    const templateId = initialAsk !== null ? initialTemplate : (fromSeason?.id ?? null);
    autoAsked.current = true;
    // asked on the next tick, not inside the effect: the box and the plan fill in as if the person had typed it (a card's own template is asked by its id)
    queueMicrotask(() => void ask(templateId ? { templateId, ask: said } : { text: said }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, initialAsk, initialSeason]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const said = text.trim();
    if (said.length < PLAN_TEXT_MIN || said.length > PLAN_TEXT_MAX) {
      setBoxError(t("jobs.new.err.text"));
      return;
    }
    void ask({ text: said });
  }
  const onBoxKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };
  /** "Use this": the card's template (the real planner starts from its id; the mock planner is given its sentence, exactly as if it had been typed). Same plan card, same Start. */
  function use(tpl: JobTemplate) {
    void ask({ templateId: tpl.id, ask: textIn(tpl.ask, lang) });
  }
  /** The round microphone of a card: its sentence goes into the box, ready to be changed by talking. */
  function say(tpl: JobTemplate) {
    setText(textIn(tpl.ask, lang));
    setPlan(null);
    boxRef.current?.focus();
    boxRef.current?.scrollIntoView?.({ block: "center" });
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
    onClose();
  }
  async function test() {
    if (!plan) return;
    const channel: PlanChannel = plan.says[0]?.channel ?? "call";
    setCard((c) => ({ ...c, testing: true, error: null, note: null }));
    const r = await actions.test(plan.planId, channel);
    if (!r.ok && r.code === "quiet_hours") {
      setCard((c) => ({ ...c, testing: false, quiet: true, note: t("jobs.job.test.quiet") }));
      return;
    }
    const sent = r.ok ? t(r.data.mock ? "jobs.new.test.mock" : channel === "call" ? "jobs.new.test.sent_call" : "jobs.new.test.sent_message") : "";
    const used = r.ok && !r.data.mock && r.data.minutesUsed > 0 ? ` ${t("jobs.job.test.used", { n: r.data.minutesUsed })}` : "";
    setCard((c) => ({ ...c, testing: false, ...(r.ok ? { note: `${sent}${used}` } : { error: r.error }) }));
  }
  function change() {
    if (!plan) return;
    setText(source && "text" in source ? source.text : source && "templateId" in source ? source.ask : plan.title);
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
    if (plan?.alternatives.find((a) => a.kind === "whatsapp")) void ask({ as: "whatsapp", planId: plan.planId }, true);
  }

  const unclear = plan?.blockers.includes("unclear_who") === true;
  const folded = plan !== null && !unclear && !ideasOpen;
  const chip = "jb-press relative inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md border px-3.5 text-[14px] font-semibold before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']";

  return (
    <div data-part="new-job-sheet" className="fixed inset-0 z-[85] flex items-end justify-center md:items-stretch md:justify-end">
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="jb-veil absolute inset-0 cursor-default border-0 bg-black/45 p-0" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="njs-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="jb-sheet relative flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-surface text-ink shadow-[var(--v2-shadow)] outline-none md:h-auto md:max-h-none md:w-[520px] md:max-w-full md:rounded-l-xl md:rounded-tr-none"
      >
        <span aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-edge opacity-70 md:hidden" />
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-2 md:px-5 md:pt-4">
          <h2 id="njs-title" className="m-0 font-display text-[22px] font-bold leading-tight text-ink">
            {t("jobs.tpl.title")}
          </h2>
          <button type="button" data-action="close" onClick={onClose} aria-label={t("jobs.tpl.close")} className="jb-press grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink">
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>
        <div data-part="sheet-body" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-8 pt-2 md:px-5">
          <form onSubmit={submit} data-part="say" className="flex flex-col gap-2">
            <label htmlFor="njs-say" className="text-[15px] font-bold leading-snug text-ink">
              {t("jobs.tpl.say.label")}
            </label>
            <div className="rounded-xl border border-brand-edge bg-surface p-2 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-brand)_25%,transparent)]">
              <textarea ref={boxRef} id="njs-say" name="job-say" rows={2} maxLength={PLAN_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onBoxKey} placeholder={t("jobs.new.placeholder")} data-voice="allow" className="block w-full resize-none rounded-xl border-0 bg-transparent px-2 py-1.5 text-[16px] leading-snug text-ink outline-none placeholder:text-muted" />
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
          {plan && !unclear ? <PlanCard plan={plan} words={words} base={base} state={card} onStart={() => void start()} onSwap={swap} onChange={change} onTest={() => void test()} onSearch={actions.search ? (patch) => void search(patch) : undefined} headingRef={planRef} /> : null}

          {loaded.state === "loading" ? (
            <div data-part="ideas-loading" role="status" aria-label={t("jobs.tpl.loading")} className="flex flex-col gap-3">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : null}
          {loaded.state === "failed" ? (
            <p role="alert" className="m-0 text-sm text-red-text">
              {loaded.error}
            </p>
          ) : null}
          {loaded.state === "ready" && !load ? (
            <p data-part="ideas-na" className="m-0 text-[14px] leading-snug text-muted">
              {t("jobs.tpl.na")}
            </p>
          ) : null}

          {folded && load ? (
            <button type="button" data-action="show-ideas" onClick={() => setIdeasOpen(true)} className="jb-press flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 text-left text-[15px] font-semibold text-ink">
              <span>{t("jobs.tpl.folded")}</span>
              <ChevronDown aria-hidden="true" className="size-5 text-muted" />
            </button>
          ) : null}

          {!folded && load ? (
            <>
              {load.data.sample ? (
                <p data-part="sample-ideas" className="m-0">
                  <SampleChip words={words} note />
                </p>
              ) : null}
              {popular.length > 0 ? (
                <section data-part="popular" aria-labelledby="njs-popular" className="flex flex-col gap-3">
                  <div>
                    <h3 id="njs-popular" className="m-0 font-display text-[18px] font-bold leading-tight text-ink">
                      {typeName ? t("jobs.tpl.popular", { type: typeName }) : t("jobs.tpl.popular.plain")}
                    </h3>
                    <p className="m-0 mt-1 text-[13.5px] leading-snug text-muted">{t("jobs.tpl.popular.sub")}</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    {popular.map((tpl, i) => (
                      <TemplateCard key={tpl.id} template={tpl} ctx={ctx} words={words} onUse={use} onSay={say} busy={planning} index={i} />
                    ))}
                  </div>
                </section>
              ) : null}

              {groups.length > 0 ? (
                <section data-part="more-ideas" aria-labelledby="njs-more" className="flex flex-col gap-2.5">
                  <h3 id="njs-more" className="m-0 font-display text-[18px] font-bold leading-tight text-ink">
                    {t("jobs.tpl.more")}
                  </h3>
                  {otherSet ? (
                    <p data-part="other-note" className="m-0 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-snug text-ink">
                      {t("jobs.tpl.others.note", { type: otherSet.name, shop: ctx.business })}
                    </p>
                  ) : null}
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {groups.map((g) => {
                      const open = openGoal === g.goal;
                      return (
                        <li key={g.goal} data-goal={g.goal} className="overflow-hidden rounded-xl border border-line bg-surface">
                          <button type="button" aria-expanded={open} onClick={() => setOpenGoal(open ? null : g.goal)} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2 text-left">
                            <span className="min-w-0 flex-1 text-[15px] font-bold text-ink">{t(`jobs.tpl.goal.${g.goal}`)}</span>
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-surface-2 px-2 text-[13px] font-bold text-ink">{g.templates.length}</span>
                            <ChevronDown aria-hidden="true" className={`size-[18px] text-muted transition-transform ${open ? "rotate-180" : ""}`} />
                          </button>
                          {open ? (
                            <ul className="m-0 flex list-none flex-col p-0">
                              {g.templates.map((tpl) => {
                                const Icon = KIND_ICON[tpl.kind];
                                const idea = openIdea === tpl.id;
                                return (
                                  <li key={tpl.id} data-idea={tpl.id} className="border-t border-line">
                                    <button type="button" aria-expanded={idea} onClick={() => setOpenIdea(idea ? null : tpl.id)} className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2 text-left">
                                      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink">
                                        <Icon className="size-[18px]" />
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block text-[15px] font-semibold leading-snug text-ink">{textIn(tpl.title, lang)}</span>
                                        <span className="line-clamp-2 block text-[13px] leading-snug text-muted">{textIn(tpl.benefit, lang)}</span>
                                      </span>
                                      <ChevronRight aria-hidden="true" className={`size-[18px] shrink-0 text-muted transition-transform ${idea ? "rotate-90" : ""}`} />
                                    </button>
                                    {idea ? (
                                      <div className="px-3 pb-3">
                                        <TemplateCard template={tpl} ctx={ctx} words={words} onUse={use} onSay={say} busy={planning} />
                                      </div>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {load.data.others.length > 0 ? (
                <section data-part="other-businesses" aria-labelledby="njs-others" className="flex flex-col gap-2">
                  <h3 id="njs-others" className="m-0 text-[12px] font-bold uppercase tracking-wider text-muted">
                    {t("jobs.tpl.others")}
                  </h3>
                  <div role="group" aria-labelledby="njs-others" className="-mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
                    <button type="button" aria-pressed={other === null} data-chip="own" onClick={() => setOther(null)} className={`${chip} first-letter:uppercase ${other === null ? "border-brand-text bg-brand-bg text-brand-text" : "border-line bg-surface text-muted"}`}>
                      {t("jobs.tpl.others.yours", { type: typeName ?? t("jobs.tpl.popular.plain") })}
                    </button>
                    {load.data.others.map((o) => (
                      <button key={o.pack} type="button" aria-pressed={other === o.pack} data-chip={o.pack} onClick={() => setOther(o.pack)} className={`${chip} first-letter:uppercase ${other === o.pack ? "border-brand-text bg-brand-bg text-brand-text" : "border-line bg-surface text-muted"}`}>
                        {textIn(o.name, lang)}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
        {started ? <StartedToast label={t("jobs.new.started")} /> : null}
      </div>
    </div>
  );
}
