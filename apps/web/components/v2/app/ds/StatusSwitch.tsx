/**
 * An On/Off status as a real TOGGLE SWITCH (owner, 26 Nov 2026): GREEN when on, RED when off, with the word beside it and the name of the thing as its accessible name.
 * Colours are the app's AA text colours (`green-text`, `red-text`) with a white knob, so the track keeps 4.5:1 against the knob in both themes. Pure markup (no state): the caller owns `on`.
 */
export function StatusSwitch({ on, label, onText, offText, busy = false, disabled = false, onChange }: { on: boolean; label: string; onText: string; offText: string; busy?: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-part="status-switch"
      data-on={on ? "" : undefined}
      disabled={busy || disabled}
      onClick={() => onChange(!on)}
      className="write-ctl inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-transparent px-1 text-sm font-semibold disabled:opacity-60"
    >
      <span aria-hidden="true" className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-green-text" : "bg-red-text"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </span>
      <span className={on ? "text-green-text" : "text-red-text"}>{on ? onText : offText}</span>
    </button>
  );
}
