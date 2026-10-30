"use client";

import * as React from "react";

export type Panel = { id: string; label: string; node: React.ReactNode };

/**
 * The sub-sections of one long settings page (owner, 30 Oct: Settings > AI assistant is split into Basics, Knowledge, Behaviour, Pronunciation and Advanced): a tab bar that is a row of pills you scroll sideways on a phone and an underlined bar on a wide screen.
 * EVERY panel stays mounted (the others are only hidden), so what was typed in one is still there when you come back to it. Deep links: `#basics` and so on pick the tab when the page opens (and on a change of the hash); choosing a tab writes it to the address
 * without scrolling the page. Keyboard: Left and Right (Home, End) move between the tabs. A tab with nothing in it is not given.
 */
export function PanelTabs({ sections, label }: { sections: readonly Panel[]; label: string }) {
  const [active, setActive] = React.useState(sections[0]?.id ?? "");
  const bar = React.useRef<HTMLDivElement>(null);
  const known = (id: string) => sections.some((s) => s.id === id);
  React.useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (known(id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.map((s) => s.id).join()]);
  React.useEffect(() => {
    // a long row on a phone: the chosen tab is brought into view inside the row (never the page)
    const el = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const row = bar.current;
    if (el && row) row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [active]);
  const choose = (id: string) => {
    setActive(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      // a browser that will not change the address: the tab still changes
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = sections.findIndex((s) => s.id === active);
    const next = e.key === "ArrowRight" ? (i + 1) % sections.length : e.key === "ArrowLeft" ? (i - 1 + sections.length) % sections.length : e.key === "Home" ? 0 : e.key === "End" ? sections.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(sections[next].id);
    bar.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="flex flex-col gap-5" data-part="section-tabs">
      <div ref={bar} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:gap-1 md:border-b md:border-line md:pb-0 [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`tab-${s.id}`}
              aria-selected={on}
              aria-controls={`panel-${s.id}`}
              tabIndex={on ? 0 : -1}
              data-tab={s.id}
              onClick={() => choose(s.id)}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold md:-mb-px md:rounded-none md:border-0 md:border-b-2 md:px-5 ${on ? "border-ink bg-ink text-bg md:border-brand-edge md:bg-transparent md:text-ink" : "border-edge bg-surface text-muted hover:bg-surface-2 md:border-transparent md:bg-transparent"}`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {sections.map((s) => (
        <div key={s.id} role="tabpanel" id={`panel-${s.id}`} aria-labelledby={`tab-${s.id}`} hidden={s.id !== active} className="flex min-w-0 flex-col gap-5">
          {s.node}
        </div>
      ))}
    </div>
  );
}
