"use client";

import * as React from "react";

import { PILL_CLASS, offsetOf, positionAt, readBox, segmentNodes, toSegments } from "@/lib/opening-line/pills";
import type { Placeholder } from "@/lib/opening-line/types";

import { VoiceMic } from "../voice-input/LazyVoiceMic";

/**
 * The greeting as ONE plain box (owner, 19 Nov 2026: "these settings are not clear"). The names the call fills in show as plain-word pills ("the customer's name"), never as curly braces; the stored text keeps the four placeholders
 * (lib/opening-line/pills.ts turns one into the other, so what is saved is what the API takes today). A pill is one piece: Backspace removes it whole. `value` is the stored text; the box is not controlled while it is typed in (the caret
 * must not jump), so a change from outside (another language, the API's answer) remounts it: the page gives it a new `key`. `insert` is the parent's handle to put a pill in at the caret (or at the end).
 * The microphone (owner style: every free-text field can be spoken): the dictation hook works on a plain text field, so a hidden textarea carries the STORED text and the caret's place in it; what is dictated goes in there at the caret (as plain text, the pills stay
 * whole beside it) and the box is drawn again from it. The words are text, never braces.
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
  const proxy = React.useRef<HTMLTextAreaElement>(null);
  const syncing = React.useRef(false);
  const dictating = React.useRef(false); // (from the dictated words until the caret has been placed after them)
  // the hidden field says what the box holds (stored text) and where the caret is in it, so a dictation lands there
  const syncProxy = (notify: boolean) => {
    const p = proxy.current;
    const el = ref.current;
    if (!p || !el) return;
    const at = caret.current && el.contains(caret.current.startContainer) ? offsetOf(el, caret.current.startContainer, caret.current.startOffset) : good.current.length;
    if (p.value !== good.current) p.value = good.current;
    try {
      p.setSelectionRange(at, at);
    } catch {
      // no caret in this field
    }
    if (notify) {
      syncing.current = true; // (an "input" tells the microphone that the text changed under its Undo; the box already has it)
      p.dispatchEvent(new Event("input", { bubbles: true }));
      syncing.current = false;
    }
  };
  const keepCaret = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.getRangeAt(0).startContainer)) caret.current = sel.getRangeAt(0).cloneRange();
    syncProxy(false);
  };
  // dictated words arrive as the hidden field's new text: the box is drawn again from it and the caret goes after the words
  const dictated = () => {
    const p = proxy.current;
    const el = ref.current;
    if (!p || !el || syncing.current || disabled) return;
    const stored = p.value;
    if (stored.length > maxLength) return;
    good.current = stored;
    el.replaceChildren(...segmentNodes(toSegments(stored), pillText));
    dictating.current = true;
    onChange(stored);
    queueMicrotask(() => {
      const [node, off] = positionAt(el, Math.min(p.selectionEnd ?? stored.length, stored.length));
      const r = document.createRange();
      r.setStart(node, off);
      r.collapse(true);
      caret.current = r;
      dictating.current = false;
    });
  };
  React.useEffect(() => {
    if (!dictating.current) syncProxy(false);
  });
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
    syncProxy(true);
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
    <div className="flex flex-col gap-2">
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
    {disabled ? null : (
      <>
        <textarea ref={proxy} id={`${id}-dictation`} aria-hidden="true" tabIndex={-1} data-voice="allow" lang={lang} maxLength={maxLength} onInput={dictated} className="sr-only" />
        <div data-part="vt-greeting-mic">
          <VoiceMic target={proxy} size="icon" />
        </div>
      </>
    )}
    </div>
  );
}

/** The stored text a box shows for a language: what the owner saved, else the suggestion the API gives. */
export const shownGreeting = (saved: string | undefined, suggested: string | undefined): string => saved ?? suggested ?? "";
