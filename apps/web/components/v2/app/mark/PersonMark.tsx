/** The tints a person's circle can have (the same person always the same one): classes written out, so the style sheet has them. */
export const PERSON_TINTS = ["bg-brand-bg text-brand-text", "bg-green-bg text-green-text", "bg-amber-bg text-amber-text", "bg-surface-2 text-ink"] as const;

/** Which tint a person gets, from their id (job DM: the agents' owls used to stand for people on the team screen). Pure. */
export function tintOf(userId: string): (typeof PERSON_TINTS)[number] {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSON_TINTS[h % PERSON_TINTS.length];
}

/** A person as a small circle with their first letter: for a list of people (the team). Decorative: the name beside it is the label. */
export function PersonMark({ userId, name, className = "size-12" }: { userId: string; name: string; className?: string }) {
  const first = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span aria-hidden="true" data-person-mark="" className={`inline-flex shrink-0 items-center justify-center rounded-full text-lg font-semibold ${tintOf(userId)} ${className}`}>
      {first}
    </span>
  );
}
