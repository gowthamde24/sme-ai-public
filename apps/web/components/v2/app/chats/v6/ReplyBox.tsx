"use client";

import * as React from "react";

import { isTouchScreen, sendsOnEnter } from "../../today/composer-keys";
import { VoiceMic } from "../../voice-input/LazyVoiceMic";

/**
 * The reply field of a chat, the same as the Today composer (product audit, Chats): one line that grows with the text (up to six lines), Enter sends and Shift+Enter is a new line on a computer, Enter is a new line on a phone (the Send button sends), never while a keyboard is composing a word. The microphone sits inside it at the right edge, like the one-line field it replaces.
 */
export function ReplyBox({ id, value, onChange, onSend, placeholder, maxLength }: { id: string; value: string; onChange: (v: string) => void; onSend: () => void; placeholder: string; maxLength: number }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [focus, setFocus] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [value]);
  return (
    <div className="relative min-w-0 flex-1" onFocus={() => setFocus(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocus(false)}>
      <textarea
        ref={ref}
        id={id}
        rows={1}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (sendsOnEnter(e, isTouchScreen())) {
            e.preventDefault();
            onSend();
          }
        }}
        className="block min-h-12 w-full resize-none rounded-[14px] border border-line bg-surface py-3 pl-3.5 pr-14 text-[14px] leading-6 text-ink placeholder:text-muted focus:border-brand-edge"
      />
      <VoiceMic target={ref} inline focused={focus} />
    </div>
  );
}
