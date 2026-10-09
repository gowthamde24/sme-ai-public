"use client";

import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A compact "add" button that opens its form in place, and only then (the form is not in the page until it is wanted). The form is the page's own,
 * unchanged: this component only shows and hides it. Escape closes it and puts the focus back on the button; opening it puts the focus in the first field.
 * `variant="menu"` is a full-width row for a pop-over menu, `variant="page"` a button for a page.
 */
export function AddButton({ label, children, variant = "page" }: { label: string; children: ReactNode; variant?: "menu" | "page" }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
  }, [open]);
  const cls =
    variant === "menu"
      ? "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-base font-semibold text-brand-text hover:bg-surface-2"
      : "inline-flex min-h-11 items-center gap-2 rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2";
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation(); // closes this form first; a second Escape closes the menu around it
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button ref={button} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={cls}>
        <Plus className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div ref={panel} id={id} className={variant === "menu" ? "px-1 pb-2 pt-1" : ""}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
