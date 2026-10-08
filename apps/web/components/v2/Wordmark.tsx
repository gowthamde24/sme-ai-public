import { BRAND_NAME } from "@/design/brand";

/** The wordmark: the name from the one brand constant, with a "(working name)" tail set smaller. Takes no name prop on purpose. */
export function Wordmark() {
  const i = BRAND_NAME.indexOf(" (");
  const main = i === -1 ? BRAND_NAME : BRAND_NAME.slice(0, i);
  const tail = i === -1 ? "" : BRAND_NAME.slice(i + 1);
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-display text-xl font-bold tracking-tight">
        {main}
        <span className="text-brand-text">.</span>
      </span>
      {tail && <span className="text-sm text-muted">{tail}</span>}
    </span>
  );
}
