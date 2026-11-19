"use client";

import * as React from "react";

import { readBox, segmentsToHtml, toSegments } from "@/lib/opening-line/pills";
import type { Placeholder } from "@/lib/opening-line/types";

/**
 * The greeting as ONE plain box (owner, 19 Nov 2026: "these settings are not clear"). The names the call fills in show as plain-word pills ("the customer's name"), never as curly braces; the stored text keeps the four placeholders
 * (lib/opening-line/pills.ts turns one into the other, so what is saved is what the API takes today). A pill is one piece: Backspace removes it whole. `value` is the stored text; the box is not controlled while it is typed in (the caret
 * must not jump), so a change from outside (another language, the API's answer) remounts it: the page gives it a new `key`. `insert` is the parent's handle to put a pill in at the caret (or at the end).
 */
export type GreetingInsert = { current: ((name: Placeholder) => void) | null };

export function GreetingBox({ id, label, value, lang, disabled, maxLength, pillText, onChange, insert }: { id: string; label: string; value: string; lang: string; disabled: boolean; maxLength: number; pillText: (name: Placeholder) => string; onChange: (stored: string) => void; insert: GreetingInsert }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [html] = React.useState(() => segmentsToHtml(toSegments(value), pillText)); // set once: React never rewrites the box while it is typed in
  const good = React.useRef(value);
  const restore = (el: HTMLDivElement) => {
    el.innerHTML = segmentsToHtml(toSegments(good.current), pillText);
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
  React.useEffect(() => {
    insert.current = (name) => {
      const el = ref.current;
      if (!el || disabled) return;
      const pill = document.createElement("span");
      pill.innerHTML = segmentsToHtml([{ kind: "pill", name }], pillText);
      const node = pill.firstChild as Node;
      el.focus();
      const sel = window.getSelection();
      const inside = sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer);
      const range = inside ? sel.getRangeAt(0) : document.createRange();
      if (!inside) {
        range.selectNodeContents(el);
        range.collapse(false);
      }
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
      read();
    };
    return () => {
      insert.current = null;
    };
  });
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
      onInput={read}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault(); // one paragraph
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        if (typeof document.execCommand === "function") document.execCommand("insertText", false, text);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
      className={`min-h-12 w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-base leading-[1.9] text-ink focus:border-brand-edge focus:outline-none ${disabled ? "opacity-80" : ""}`}
    />
  );
}

/** The stored text a box shows for a language: what the owner saved, else the suggestion the API gives. */
export const shownGreeting = (saved: string | undefined, suggested: string | undefined): string => saved ?? suggested ?? "";
