import { Mark } from "@/components/v2/Mark";
import { BRAND_NAME } from "@/design/brand";

/** The wordmark: the three-bar logo (28 px) and the name from the one brand constant. Takes no name prop on purpose. */
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 leading-tight">
      <Mark px={28} />
      <span className="font-display text-2xl font-extrabold tracking-tight">{BRAND_NAME}</span>
    </span>
  );
}
