/**
 * The one line the assistant leaves on the page it opens ("Showing these leads; the date part is not available yet, so it shows all of them"). The assistant's card keeps it here, in the memory of this browser tab,
 * just before it opens the page, and the page takes it once. The assistant opens pages with the app's own router (no reload), so the memory is still there. It is NOT put in the address (a link someone else made
 * could then put its own words on the owner's screen) and NOT written to any storage. A reload loses it, which is fine: the note is only for the moment the page opens. Decided by C2, owner can reverse.
 */
const MAX = 200;

export type Note = { page: "leads"; text: string };

let kept: Note | null = null;

export function stashNote(page: Note["page"], text: string): void {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX);
  kept = clean === "" ? null : { page, text: clean };
}

/** The note for this page, once: it is forgotten as it is read. A note meant for another page stays where it is. */
export function takeNote(page: Note["page"]): string | null {
  if (kept === null || kept.page !== page) return null;
  const text = kept.text;
  kept = null;
  return text;
}
