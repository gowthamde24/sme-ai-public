/**
 * The one line the assistant leaves on the page it opens ("Showing these leads; the date part is not available yet, so it shows all of them"). The assistant's card stores it here in the browser tab just before it
 * opens the page, and the page takes it once. It is NOT put in the address: a link someone else made could then put its own words on the owner's screen. Decided by C2, owner can reverse.
 */
const KEY = "sme_assistant_note";
const MAX = 200;

export type Note = { page: "leads"; text: string };

export function stashNote(page: Note["page"], text: string): void {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX);
  if (clean === "") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ page, text: clean }));
  } catch {
    // private window or blocked storage: the page simply has no note
  }
}

/** The note for this page, once: it is removed as it is read. Anything that does not read exactly as written above is dropped. */
export function takeNote(page: Note["page"]): string | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<Note> | null;
    if (v && v.page === page && typeof v.text === "string" && v.text.trim() !== "") {
      window.sessionStorage.removeItem(KEY);
      return v.text.slice(0, MAX);
    }
    return null;
  } catch {
    return null;
  }
}
