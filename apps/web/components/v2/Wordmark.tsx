import { Orb } from "@/components/v2/Orb";
import { BRAND_NAME } from "@/design/brand";

/** The wordmark: the AI circle (still, 28 px: the logo mark of job DM) and the name from the one brand constant. Takes no name prop on purpose. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 leading-tight">
      <Orb px={28} state="still" />
      <span className="font-display text-2xl font-extrabold tracking-tight">{BRAND_NAME}</span>
    </span>
  );
}
