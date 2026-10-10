/** The Main agent's moods, as the Ask box drives them (see design/owl.css): `resting` while there is nothing to ask, `listening` while the microphone is open, `thinking` until the first word of an answer, `answering` while it streams. */
export type OwlState = "idle" | "listening" | "thinking" | "answering" | "resting";

/** The Main agent as a flat owl. Decorative: the name next to it is the label, and the box's own status text carries what it is doing. The colours and the movement are in design/owl.css. */
export function OwlAvatar({ state = "idle", className = "size-12" }: { state?: OwlState; className?: string }) {
  return (
    <svg viewBox="0 0 240 250" className={`owl shrink-0 ${className}`} data-state={state} aria-hidden="true" focusable="false">
      <circle className="ring" cx="120" cy="130" r="112" />
      <g className="whole">
        <ellipse className="body" cx="120" cy="165" rx="70" ry="68" />
        <ellipse className="belly" cx="120" cy="178" rx="44" ry="46" />
        <g className="bars">
          <path d="M100 160q10 5 20 0q10 5 20 0" />
          <path d="M98 176q11 5 22 0q11 5 22 0" />
          <path d="M100 192q10 5 20 0q10 5 20 0" />
          <path d="M106 207q7 4 14 0q7 4 14 0" />
        </g>
        <path className="wing" d="M52 140q-14 40 4 76q14-6 18-34q2-28-22-42z" />
        <path className="wing" d="M188 140q14 40-4 76q-14-6-18-34q-2-28 22-42z" />
        <g className="tuft">
          <path d="M70 62l-6-26 22 18z" />
          <path d="M170 62l6-26-22 18z" />
        </g>
        <ellipse className="head" cx="120" cy="92" rx="72" ry="60" />
        <g className="eyes">
          <circle className="face" cx="88" cy="94" r="31" />
          <circle className="face" cx="152" cy="94" r="31" />
          <circle className="iris" cx="91" cy="96" r="13" />
          <circle className="iris" cx="149" cy="96" r="13" />
          <circle className="pupil" cx="92" cy="97" r="7" />
          <circle className="pupil" cx="148" cy="97" r="7" />
          <circle className="glint" cx="95" cy="92" r="3" />
          <circle className="glint" cx="151" cy="92" r="3" />
        </g>
        <rect className="lid" x="57" y="62" width="62" height="64" rx="31" />
        <rect className="lid" x="121" y="62" width="62" height="64" rx="31" />
        <path className="beak" d="M112 112l8 22l8-22q-8-6-16 0z" />
        <g className="feet">
          <path d="M96 228h20l-4 8h-12z" />
          <path d="M124 228h20l-4 8h-12z" />
        </g>
      </g>
      <g className="dots">
        <circle className="dot" cx="196" cy="34" r="6" />
        <circle className="dot" cx="214" cy="34" r="6" />
        <circle className="dot" cx="232" cy="34" r="6" />
      </g>
    </svg>
  );
}
