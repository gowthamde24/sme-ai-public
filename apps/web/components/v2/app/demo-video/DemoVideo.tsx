"use client";

import * as React from "react";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import * as F from "@/lib/demo-video/fixtures";
import { BEATS, FOCUS, keyMove, nextIndex, type Beat, type Screen } from "@/lib/demo-video/script";
import type { Reply } from "../cc/kit";
import type { FrameData } from "../contract";
import { FrameDataSlot } from "../frame-store";
import { BackLink, PageTop } from "../parts";
import { FinderBox, type FinderActions } from "../prospects/FinderBox";
import { ProspectList, type ListActions } from "../prospects/ProspectList";
import type { TodayActions } from "../today/actions-types";
import { TodayView } from "../today/TodayView";
import { pageMain, pillLinkBase, pillLinkInfo, pillLinkQuiet } from "../ui";
import { ChatThread } from "../whatsapp/ChatThread";
import type { ChatActions } from "../whatsapp/wa-types";
import { makeT, type Words } from "../words";

import "./demo-video.css";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ok = <T,>(data: T): Reply<T> => ({ ok: true, data });
/** How long each fake answer "takes": long enough to see the button say it is working, short enough for a 60-second video. */
const WAIT = { approve: 450, plan: 550, search: 1200, call: 1800, preview: 350, make: 650, answer: 1700 } as const;
/** The menu's count on Today follows the story (what Needs you shows). */
const WAITING: Record<Screen, number> = { "today-calm": 2, "today-lead": 3, chat: 2, prospects: 2, "today-done": 3 };

export type DemoVideoProps = { words: Words; base: string; lang: string; /** The moment the page was drawn (ms): every time on the screens is relative to it. */ now: number; /** The frame's real numbers (plan, AI usage, the menu of the business type): the story only changes the count on Today and switches "Live now" off. */ frame: FrameData };

/**
 * The demo video (job demo-video): an eight-step story on the REAL screens, for a screen recording. Today -> a new WhatsApp lead (a reply drafted in Telugu, with its English) -> the owner approves -> the chat -> a Lead Finder search ->
 * a practice call -> the draft quote -> "Done while you slept". Every screen is the product's own component fed by fixtures (lib/demo-video/fixtures.ts) with fake answers made right here, in the browser: nothing is read for it, sent,
 * saved or dialled. The presenter paces it: the one thing to click in each beat reacts (lib/demo-video/script.ts); a click on the page, the right arrow, Page Down or N goes on; R or Home starts again at step 1 at once; Escape leaves.
 * Links never navigate here (the menu's included), so a slip of the mouse does not leave the story. Drawn only after the server's guard (lib/demo-video/guard.ts) said yes.
 */
export default function DemoVideo({ words, base, lang, now, frame }: DemoVideoProps) {
  const t = React.useMemo(() => makeT(words), [words]);
  const [index, setIndex] = React.useState(0);
  const [run, setRun] = React.useState(0);
  const [answered, setAnswered] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const indexRef = React.useRef(0);
  const runRef = React.useRef(0);
  const timers = React.useRef<number[]>([]);
  const beat: Beat = BEATS[index];

  const go = React.useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
  }, []);
  const later = React.useCallback((fn: () => void, ms: number) => {
    const mine = runRef.current;
    timers.current.push(window.setTimeout(() => mine === runRef.current && fn(), ms));
  }, []);
  /** Moves on only from the beat that asked (a late answer after a reset, or a second press, changes nothing). */
  const advanceFrom = React.useCallback(
    (id: string, mine: number) => {
      if (mine !== runRef.current || BEATS[indexRef.current]?.id !== id) return;
      go(nextIndex(indexRef.current));
    },
    [go],
  );
  const next = React.useCallback(() => {
    const b = BEATS[indexRef.current];
    const el = b.target ? stage.current?.querySelector<HTMLElement>(b.target) : null;
    if (el) el.click();
    else go(nextIndex(indexRef.current));
  }, [go]);
  const reset = React.useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    runRef.current += 1;
    setRun(runRef.current);
    setAnswered(false);
    go(0);
    window.scrollTo({ top: 0 });
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [go]);
  React.useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  // the fake answers of the real components' buttons: made here, after a short pause; each moves the story on from its own beat
  const actions = React.useMemo(() => {
    const mine = run;
    const today: TodayActions = {
      approveMessage: async () => {
        await sleep(WAIT.approve);
        advanceFrom("reply", mine);
        return { ok: true, message: t("today.toast.sent", { customer: F.LEAD.name }) };
      },
      rejectMessage: async () => ({ ok: true, message: "" }),
      editMessage: async (_id, text) => ({ ok: true, message: "", text }),
      approveCall: async () => ({ ok: true, message: "" }),
      offerVisit: async () => ({ ok: true, message: "" }),
      visit: null,
    };
    const finder: FinderActions = {
      plan: async () => {
        await sleep(WAIT.plan);
        advanceFrom("finder", mine);
        return ok(F.plannedSearch(now));
      },
      approve: async () => {
        await sleep(WAIT.search);
        advanceFrom("plan", mine);
        return ok(F.doneSearch(now));
      },
      cancel: async () => ok({ ...F.plannedSearch(now), state: "cancelled" }),
    };
    const list: ListActions = {
      act: async () => ok([]),
      practice: async () => {
        await sleep(WAIT.call);
        advanceFrom("start", mine);
        return ok(F.practiceCall(now));
      },
      quoteDraft: async () => {
        await sleep(WAIT.preview);
        return ok(F.QUOTE_PREVIEW);
      },
      makeQuoteDraft: async () => {
        await sleep(WAIT.make);
        advanceFrom("quote", mine);
        return ok(F.QUOTE_MADE);
      },
    };
    return { today, finder, list };
  }, [run, now, t, advanceFrom]);
  const answeredRef = React.useRef(false);
  React.useEffect(() => {
    answeredRef.current = answered;
  }, [answered]);
  const chat: ChatActions = React.useMemo(
    () => ({
      reply: async () => ok({ status: "needs_approval", reason: "money" }),
      approve: async () => ok({ status: "sent", reason: "" }),
      reject: async () => ok({ status: "blocked", reason: "owner_rejected" }),
      refresh: async () => ok(F.chatThread(now, answeredRef.current)),
      markRead: async () => ok(null),
    }),
    [now],
  );

  // the keys of the presenter (and a clicker's Page Down); not while a field has the keyboard
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const move = keyMove(e);
      if (move === null) return;
      e.preventDefault();
      if (move === "next") next();
      else if (move === "reset") reset();
      else window.location.assign(base); // a full load: the frame draws the workspace as it really is again
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, reset, base]);

  // the menu's links (outside the stage) do not leave the story either
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || stage.current?.contains(el) || !el.closest("a[href]")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // each beat: a new screen starts at the top; the part the beat is about is brought into view; the short beats move on by themselves
  const shown = React.useRef<Screen | null>(null);
  React.useEffect(() => {
    if (shown.current !== beat.screen) window.scrollTo({ top: 0 });
    shown.current = beat.screen;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // the part may arrive a moment later (the draft quote's preview after the call): looked for again for up to two seconds
    const sel = beat.target ?? FOCUS[beat.id];
    const bring = (tries: number) => {
      const el = sel ? stage.current?.querySelector<HTMLElement>(sel) : null;
      if (!el) return void (tries > 0 && later(() => bring(tries - 1), 150));
      const r = el.getBoundingClientRect();
      if (r.top < 72 || r.bottom > window.innerHeight - 24) el.scrollIntoView?.({ block: "center", behavior: smooth ? "smooth" : "auto" });
    };
    if (sel) later(() => bring(12), 260);
    if (beat.auto) later(() => advanceFrom(beat.id, runRef.current), beat.auto);
    if (beat.id === "chat") later(() => setAnswered(true), WAIT.answer);
  }, [beat, run, later, advanceFrom]);

  // a click in the stage: the beat's one target works; a link never navigates; anything else is held still, and in a beat without a target the click moves the story on
  const onClickCapture = (e: React.MouseEvent) => {
    const el = e.target as Element;
    const b = BEATS[indexRef.current];
    const target = b.target ? stage.current?.querySelector(b.target) : null;
    const inside = target ? target.contains(el) : false;
    const mine = runRef.current;
    if (el.closest("a")) {
      e.preventDefault();
      e.stopPropagation();
      if (inside && b.on === "click") advanceFrom(b.id, mine);
      else if (!b.target) next();
      return;
    }
    if (inside) {
      if (b.on === "click") later(() => advanceFrom(b.id, mine), 0);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!b.target) next();
  };

  const frameNow = React.useMemo<FrameData>(() => ({ ...frame, live: false, logoUrl: null, waiting: beat.screen === "today-lead" && index > BEATS.findIndex((x) => x.id === "reply") ? 2 : WAITING[beat.screen] }), [frame, beat.screen, index]);
  const found = index >= BEATS.findIndex((x) => x.id === "found");

  return (
    <div ref={stage} data-dv-stage="" data-dv-beat={beat.id} data-dv-step={beat.step} data-dv-answered={answered ? "" : undefined} onClickCapture={onClickCapture}>
      <FrameDataSlot data={frameNow} />
      {beat.screen === "today-calm" || beat.screen === "today-lead" || beat.screen === "today-done" ? (
        <main key={`${run}-${beat.screen}`} data-dv-screen={beat.screen} className={pageMain} lang={lang}>
          <TodayView data={F.todayData(now, base, beat.screen === "today-calm" ? "calm" : beat.screen === "today-lead" ? "lead" : "done")} name={F.BUSINESS.owner} hour={9} now={now} base={base} t={t} lang={lang} role="owner" actions={actions.today} outboxHref={`${base}/outbox?tab=sent`} />
        </main>
      ) : beat.screen === "chat" ? (
        <main key={`${run}-chat`} data-dv-screen="chat" className={pageMain} lang={lang}>
          <BackLink href={`${base}/chats`} label={t("wa.chats.title")} />
          <PageTop title={F.LEAD.name} />
          <div className="mt-6 max-w-3xl">
            <ChatThread key={answered ? "answered" : "sent"} words={words} thread={F.chatThread(now, answered)} role="owner" quiet={null} now={now} actions={chat} />
          </div>
        </main>
      ) : (
        <main key={`${run}-prospects`} data-dv-screen="prospects" className={pageMain} lang={lang}>
          <PageTop title={t("lf.title")} sub={t("lf.sub")} />
          <div className="mt-4 flex max-w-3xl flex-col gap-4">
            <FinderBox words={words} canApprove base={base} actions={actions.finder} initialText={F.FINDER_TEXT} onApproved={() => undefined} />
            {found ? (
              <div data-dv-appear="" className="flex flex-col gap-4">
                <nav aria-label={t("lf.f.label")} className="flex flex-wrap gap-2" data-filter="">
                  {[null, "needs_owner", "call_ready", "skipped"].map((s) => {
                    const n = s === null ? 18 : s === "needs_owner" ? 4 : s === "call_ready" ? 6 : 8;
                    const word = s ? t(`lf.status.${s}`) : t("lf.f.all");
                    return (
                      <a key={s ?? "all"} href={`${base}/retailers${s ? `?status=${s}` : ""}`} aria-current={s === null ? "page" : undefined} className={`${pillLinkBase} ${s === null ? pillLinkInfo : pillLinkQuiet}`}>
                        {`${word} (${n})`}
                      </a>
                    );
                  })}
                </nav>
                <ProspectList items={F.prospects(now)} words={words} base={base} canPractice labelFixture={false} langNames={{ en: CALL_LANG_NAMES.en, te: CALL_LANG_NAMES.te }} actions={actions.list} />
              </div>
            ) : null}
          </div>
        </main>
      )}
    </div>
  );
}
