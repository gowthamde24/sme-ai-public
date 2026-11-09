"use client";

import * as React from "react";

import { VoiceMic } from "./LazyVoiceMic";

type Size = "icon" | "wide" | "big";

/**
 * A text field with its microphone under it (owner decision, 9 Nov 2026: every free-text field can be spoken). The field is the plain one the screen had (same props, same look): the microphone only writes into it the way typing
 * does, so the screen's own state, limits and Save are untouched. A disabled or read-only field gets no microphone, and the microphone refuses a field that must never have one (voiceAllowed in VoiceMic).
 */
export function DictInput({ wrap = "", voice, className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { wrap?: string; /** "allow": a school workspace may have the microphone here too (the field is not about students, parents or classes) */ voice?: "allow" }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [focus, setFocus] = React.useState(false);
  const editable = !rest.disabled && !rest.readOnly;
  // a ONE-LINE field stays one line at the width it had: the box around it takes the field's place in the layout (`wrap` carries what the field's own classes did: flex-1, basis-56...), the microphone is a round button inside it at the right edge, and the field's right padding keeps the text from running under it
  return (
    <div className={`relative w-full min-w-0 ${wrap}`} onFocus={() => setFocus(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocus(false)}>
      <input ref={ref} data-voice={voice} {...rest} className={`${className}${editable ? " pr-14" : ""}`} />
      {editable ? <VoiceMic target={ref} inline focused={focus} /> : null}
    </div>
  );
}

export function DictTextarea({ mic = "wide", wrap = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mic?: Size; wrap?: string; voice?: "allow" }) {
  const { voice, ...rest } = props;
  const ref = React.useRef<HTMLTextAreaElement>(null);
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${wrap}`}>
      <textarea ref={ref} data-voice={voice} {...rest} />
      {rest.disabled || rest.readOnly ? null : <VoiceMic target={ref} size={mic} />}
    </div>
  );
}
