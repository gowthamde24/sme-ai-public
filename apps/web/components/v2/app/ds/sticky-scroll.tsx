"use client";

import * as React from "react";

/**
 * A transcript that follows the newest line (owner, 14 Nov): while the reader is at the bottom it stays at the bottom as lines arrive or grow; if they scrolled up on purpose it is left alone and a "↓ New" pill says there is more below.
 * `resetKey` is the thing being shown (a chat, a conversation): a new one always opens at the bottom. `signature` changes whenever the content changes (the number of lines plus the length of the last one); `near` is how many pixels from the bottom still counts as "at the bottom".
 */
export function useStickyScroll<E extends HTMLElement>(signature: string | number, resetKey: string | number = "", near = 48) {
  const ref = React.useRef<E | null>(null);
  const stuck = React.useRef(true);
  const [unseen, setUnseen] = React.useState(false);
  const onScroll = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= near;
    stuck.current = atBottom;
    if (atBottom) setUnseen(false);
  }, [near]);
  const shown = React.useRef(resetKey);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shown.current !== resetKey) {
      shown.current = resetKey;
      stuck.current = true;
    }
    if (stuck.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [signature]);
  const toBottom = React.useCallback(() => {
    const el = ref.current;
    stuck.current = true;
    setUnseen(false);
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  return { ref, onScroll, unseen, toBottom };
}

/** The "↓ New" pill: sits at the bottom edge of the transcript's own box (the box needs `relative`); shown only when there is something unseen below. */
export function NewPill({ unseen, onClick, label, inside = false }: { unseen: boolean; onClick: () => void; label: string; /** the pill is the last child INSIDE the scrolling box (it sticks to its bottom edge): for a box whose own layout cannot take a wrapper */ inside?: boolean }) {
  if (!unseen) return null;
  const pill = (
    <button
      type="button"
      data-part="new-pill"
      onClick={onClick}
      className="absolute bottom-2 left-1/2 z-10 min-h-9 -translate-x-1/2 rounded-md border border-brand-edge bg-brand px-3.5 text-xs font-bold text-on-brand shadow-[var(--v2-shadow-pop)]"
    >
      {label}
    </button>
  );
  return inside ? <div className="sticky bottom-0 h-0">{pill}</div> : pill;
}
