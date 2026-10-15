"use client";

import * as React from "react";

/**
 * A confirmation sheet (jobs CO, CQ, CS; blueprint 8: every money action asks for a confirmation that shows the amount in words). On a phone it slides up from the bottom edge and covers the width; on a desktop
 * it is a centred card. It is a real dialog: the page behind is hidden from a screen reader, focus moves into it and comes back to the button that opened it, Escape and a tap on the dim area close it, and Tab
 * stays inside. It does nothing by itself: the buttons inside decide. `busy` stops it closing while work is being done.
 */
export function Sheet({ open, onClose, title, children, busy = false, closeLabel, id }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; busy?: boolean; closeLabel: string; id: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea");
    (first ?? node)?.focus();
    return () => opener.current?.focus();
  }, [open]);
  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 md:items-center" data-sheet={id} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} onKeyDown={onKey} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-xl md:max-w-xl md:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-title`} className="font-display text-2xl font-bold leading-tight">{title}</h2>
          <button type="button" disabled={busy} onClick={onClose} aria-label={closeLabel} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-edge text-xl hover:bg-surface-2 disabled:opacity-60">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
