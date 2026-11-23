"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * My assistant in the open layout: ONE screen with two tabs, "To your customers" (the voice, how it talks, the background, the greeting and the test call) and "To you" (how it talks to the owner). The
 * panels are server-rendered cards passed in as children; only the tab state lives here. Real tabs: a tablist, the arrow keys move between them, the hidden panel is not in the page flow.
 * The look (hairline sections, no card box) is in design/ds.css under `[data-open="mya"]`.
 */
export function OpenTabs({ customers, you, labels }: { customers: ReactNode; you: ReactNode | null; labels: { customers: string; you: string; tabs: string } }) {
  const [on, setOn] = useState<"customers" | "you">("customers");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const items = [{ k: "customers" as const, t: labels.customers }, ...(you ? [{ k: "you" as const, t: labels.you }] : [])];
  const move = (i: number, d: number) => {
    const n = (i + d + items.length) % items.length;
    setOn(items[n].k);
    refs.current[n]?.focus();
  };
  return (
    <div data-open="mya" className="flex flex-col gap-4">
      {items.length > 1 ? (
        <div role="tablist" aria-label={labels.tabs} className="flex gap-6 border-b border-line">
          {items.map((it, i) => (
            <button
              key={it.k}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`mya-tab-${it.k}`}
              aria-selected={on === it.k}
              aria-controls={`mya-panel-${it.k}`}
              tabIndex={on === it.k ? 0 : -1}
              onClick={() => setOn(it.k)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") { e.preventDefault(); move(i, 1); }
                else if (e.key === "ArrowLeft") { e.preventDefault(); move(i, -1); }
              }}
              className={`-mb-px min-h-11 border-b-2 pb-2 text-[16px] ${on === it.k ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-muted"}`}
            >
              {it.t}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id="mya-panel-customers" aria-labelledby="mya-tab-customers" hidden={on !== "customers"} className="flex flex-col gap-6">
        {customers}
      </div>
      {you ? (
        <div role="tabpanel" id="mya-panel-you" aria-labelledby="mya-tab-you" hidden={on !== "you"} className="flex flex-col gap-6">
          {you}
        </div>
      ) : null}
    </div>
  );
}
