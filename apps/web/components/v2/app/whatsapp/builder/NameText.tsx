import { nameParts } from "@/lib/templates/meta-checks";

/** A message text with the customer's name drawn as a plain "Name" chip (never as braces: the text holds `{name}`, the screen never shows it). A line break stays a line break. */
export function NameText({ text, chip }: { text: string; chip: string }) {
  return (
    <>
      {nameParts(text).map((p, i) =>
        p.kind === "name" ? (
          <span key={i} data-part="name-chip" className="mx-0.5 inline-block rounded-md bg-brand-bg px-2.5 text-[0.92em] font-bold leading-6 text-brand-text">
            {chip}
          </span>
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {p.text}
          </span>
        ),
      )}
    </>
  );
}
