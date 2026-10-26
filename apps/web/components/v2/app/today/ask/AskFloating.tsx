"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { workspaceOf } from "../../nav";
import { orbStateOf } from "../../mark/orb-state";
import { chipsForPath, orbHidden } from "./ask-chips";
import type { AskWords } from "./ask-words";
import type { AskSession } from "./use-ask-session";

/** The panel is a chunk of its own: it is drawn only after the orb is pressed (the route-JS budget counts what a page loads at first). */
const AskPanel = dynamic(() => import("./AskPanel").then((m) => m.AskPanel), { ssr: false });

/** Is the keyboard focus somewhere a letter is being typed? "/" then belongs to the field, not to us. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * The floating way to ask, on every screen but Today and the live call (job DQ part 0): a 56 px circle at the bottom right (the same AI circle, breathing while idle, thinking or speaking as the assistant is, with a small dot when an answer
 * arrived that the person has not seen). Pressed, it opens the panel (AskPanel): a small chat bottom right on a laptop, a sheet 70 % high on a phone. "/" or Cmd/Ctrl+K opens it from the keyboard; Esc or the close button returns to the circle.
 * On Today the same keys put the cursor in the card's own line. Nothing here is fixed to the bottom as a bar: there is no bar.
 */
export function AskFloating({ session, chipWords }: { session: AskSession; chipWords: AskWords }) {
  const pathname = usePathname();
  const tab = useSearchParams()?.get("tab") ?? null;
  const rest = workspaceOf(pathname ?? "")?.rest ?? null;
  const here = rest !== null && !orbHidden(rest, tab);
  const [open, setOpen] = React.useState(false);
  const [seenAt, setSeenAt] = React.useState(0); // how many finished answers the person has seen
  const orbRef = React.useRef<HTMLButtonElement>(null);
  const [shownFor, setShownFor] = React.useState(pathname);
  // a move to another screen closes the panel (state adjusted while rendering, not in an effect)
  if (shownFor !== pathname) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }
  const unseen = !open && session.finished > seenAt;
  const openPanel = React.useCallback(() => {
    setOpen(true);
    setSeenAt(session.finished);
  }, [session.finished]);
  const closePanel = React.useCallback(() => {
    setOpen(false);
    setSeenAt(session.finished);
    window.setTimeout(() => orbRef.current?.focus(), 0);
  }, [session.finished]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target);
      if (!cmdK && !slash) return;
      if (rest === null) return;
      e.preventDefault();
      if (here) openPanel();
      else document.getElementById("ask-input")?.focus(); // Today: the card's own line
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rest, here, openPanel]);
  if (!here) return null;
  const w = session.w;
  const name = w("ask.orb.open");
  return (
    <>
      <button
        ref={orbRef}
        type="button"
        data-ask="orb"
        aria-label={unseen ? `${name}. ${w("ask.orb.new")}` : name}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={name}
        onClick={() => (open ? closePanel() : openPanel())}
        onMouseEnter={() => void import("./AskPanel")}
        onFocus={() => void import("./AskPanel")}
        className={`fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 z-30 grid size-14 place-items-center rounded-full border border-line bg-surface shadow-[var(--v2-shadow-pop)] transition-transform duration-150 hover:scale-105 focus-visible:outline-2 motion-reduce:transition-none md:bottom-6 md:right-6 print:hidden ${open ? "max-md:hidden" : ""}`}
      >
        <Orb px={44} state={session.asking && !session.answer ? "think" : session.playing || session.asking ? "speak" : "ambient"} />
        {unseen ? <span data-ask="dot" aria-hidden="true" className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-surface bg-brand" /> : null}
      </button>
      {open ? <AskPanel session={session} chips={chipsForPath(rest ?? "", tab).map((k) => chipWords[k] ?? k)} onClose={closePanel} /> : null}
    </>
  );
}

export { orbStateOf };
