/** What the circle is doing: nothing (`still`: lists, the logo, the app icon), breathing (`ambient`), thinking (faster) or speaking (it pulses and its edge ripples). */
export type OrbState = "still" | "ambient" | "think" | "speak";

const STATE_CLASS: Record<OrbState, string> = { still: "orb-still", ambient: "", think: "orb-think", speak: "orb-speak" };

/**
 * The AI circle (job DM): the one mark of the product, drawn with CSS only (design/orb.css), no picture and no script, so it is a server component and weighs nothing. `px` is its size in CSS pixels; `halo` adds the two rings that
 * spread outwards (the live call, voice mode, the call-to-action). It is decorative: the name beside it says what it is. With "reduce motion" it does not move. The size sits on its own wrapper because v2 code never puts a
 * `style` and a `className` on one element (audit:leaks); `className` is for where it stands (margins, `shrink-0`, a different size from a breakpoint).
 */
export function Orb({ px, state = "ambient", halo = false, className = "" }: { px: number; state?: OrbState; halo?: boolean; className?: string }) {
  const sphere = (
    <span style={{ display: "block", width: px, height: px, flex: "none" }}>
      <span className={`orb ${STATE_CLASS[state]}`} data-orb={state} aria-hidden="true" />
    </span>
  );
  return halo ? (
    <span className={`orb-halo ${className}`} aria-hidden="true">
      {sphere}
    </span>
  ) : (
    <span className={`inline-flex shrink-0 items-center justify-center ${className}`} aria-hidden="true">
      {sphere}
    </span>
  );
}
