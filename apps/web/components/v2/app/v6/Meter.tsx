/** A progress bar with its words (design system v6: a campaign's progress, minutes used). A real <progress>, so a screen reader says "label, 40 of 100"; the text beside it says the same in words, so the bar is never the only sign. */
export function Meter({ label, value, max, text }: { label: string; value: number; max: number; text?: string }) {
  const safeMax = max > 0 ? max : 1;
  const v = Math.min(Math.max(value, 0), safeMax);
  return (
    <div className="flex items-center gap-3" data-part="meter">
      <progress value={v} max={safeMax} aria-label={label} className="h-2.5 min-w-0 flex-1 accent-brand-edge" />
      {text ? <span className="shrink-0 text-sm font-semibold text-muted">{text}</span> : null}
    </div>
  );
}
