"use client";

import * as React from "react";

import { PILL_CLASS, readBox, segmentNodes, toSegments } from "@/lib/opening-line/pills";
import type { Placeholder } from "@/lib/opening-line/types";

/**
 * The greeting as ONE plain box (owner, 19 Nov 2026: "these settings are not clear"). The names the call fills in show as plain-word pills ("the customer's name"), never as curly braces; the stored text keeps the four placeholders
 * (lib/opening-line/pills.ts turns one into the other, so what is saved is what the API takes today). A pill is one piece: Backspace removes it whole. `value` is the stored text; the box is not controlled while it is typed in (the caret
 * must not jump), so a change from outside (another language, the API's answer) remounts it: the page gives it a new `key`. `insert` is the parent's handle to put a pill in at the caret (or at the end).
 */
export type GreetingHandle = { insert: (name: Placeholder) => void };

export function GreetingBox({ id, label, value, lang, disabled, maxLength, pillText, onChange, ref: handle }: { id: string; label: string; value: string; lang: string; disabled: boolean; maxLength: number; pillText: (name: Placeholder) => string; onChange: (stored: string) => void; /** the parent's handle: `insert(name)` puts a pill in at the caret (or at the end) */ ref?: React.Ref<GreetingHandle> }) {
  const ref = React.useRef<HTMLDivElement>(null);
  // the first content is made once and the same elements are drawn every time: React sees nothing to change, so it never touches the box while it is typed in (the DOM is the box's own from then on)
  const [first] = React.useState(() => toSegments(value).map((sg, i) => (sg.kind === "text" ? sg.text : (
    <span key={i} contentEditable={false} data-ph={sg.name} className={PILL_CLASS}>
      {pillText(sg.name)}
    </span>
  ))));
  const good = React.useRef(value);
  const caret = React.useRef<Range | null>(null);
  const keepCaret = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.getRangeAt(0).startContainer)) caret.current = sel.getRangeAt(0).cloneRange();
  };
  const restore = (el: HTMLDivElement) => {
    el.replaceChildren(...segmentNodes(toSegments(good.current), pillText));
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
  const read = () => {
    const el = ref.current;
    if (!el) return;
    const stored = readBox(el);
    if (stored.length > maxLength) return restore(el);
    good.current = stored;
    onChange(stored);
  };
  React.useImperativeHandle(handle, () => ({
    insert: (name) => {
      const el = ref.current;
      if (!el || disabled) return;
      const node = segmentNodes([{ kind: "pill", name }], pillText)[0];
      // where the caret was when the box was left (a tap on "Add ..." moves focus away); never been in the box: the end
      const range = caret.current && el.contains(caret.current.startContainer) ? caret.current : document.createRange();
      if (!(caret.current && el.contains(caret.current.startContainer))) {
        range.selectNodeContents(el);
        range.collapse(false);
      }
      el.focus();
      const sel = window.getSelection();
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      caret.current = range.cloneRange();
      read();
    },
  }));
  return (
    <div
      ref={ref}
      id={id}
      role="textbox"
      aria-multiline="false"
      aria-label={label}
      aria-disabled={disabled || undefined}
      lang={lang}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-part="vt-greeting-box"
      spellCheck={false}
      onInput={() => (read(), keepCaret())}
      onBlur={keepCaret}
      onKeyUp={keepCaret}
      onMouseUp={keepCaret}
      onTouchEnd={keepCaret}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault(); // one paragraph
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        if (typeof document.execCommand === "function") document.execCommand("insertText", false, text);
      }}
      className={`min-h-12 w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-base leading-[1.9] text-ink focus:border-brand-edge focus:outline-none ${disabled ? "opacity-80" : ""}`}
    >
      {first}
    </div>
  );
}

/** The stored text a box shows for a language: what the owner saved, else the suggestion the API gives. */
export const shownGreeting = (saved: string | undefined, suggested: string | undefined): string => saved ?? suggested ?? "";
