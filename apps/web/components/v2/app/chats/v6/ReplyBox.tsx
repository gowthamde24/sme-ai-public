"use client";

import * as React from "react";

import { isTouchScreen, sendsOnEnter } from "../../today/composer-keys";

const MAX_PX = 144;

/**
 * The reply field of a chat: ONE text box across the full width of the composer (the toolbar with attach, mic, language and Send sits on its own row under it, owner 16 Nov: the mic used to sit inside the box and overlap the text and the scrollbar). It is one line that grows with the text up to six lines; a scrollbar shows only when the text is longer than that, never on an empty or short box. Enter sends and Shift+Enter is a new line on a computer, Enter is a new line on a phone (the Send button sends).
 */
export function ReplyBox({ id, value, onChange, onSend, placeholder, maxLength, inputRef, disabled = false }: { id: string; value: string; onChange: (v: string) => void; onSend: () => void; placeholder: string; maxLength: number; inputRef: React.RefObject<HTMLTextAreaElement | null>; disabled?: boolean }) {
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = el.scrollHeight;
    el.style.height = `${Math.min(h, MAX_PX)}px`;
    el.style.overflowY = h > MAX_PX ? "auto" : "hidden";
  }, [value, inputRef]);
  return (
    <textarea
      ref={inputRef}
      id={id}
      rows={1}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (sendsOnEnter(e, isTouchScreen())) {
          e.preventDefault();
          onSend();
        }
      }}
      className="block min-h-12 w-full resize-none overflow-y-hidden rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] leading-6 text-ink placeholder:text-muted focus:border-brand-edge disabled:opacity-60"
    />
  );
}
