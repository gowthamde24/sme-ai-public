import type { Reply } from "../cc/kit";
import type { SellEntry, SellForm, SellNote, SellStyle } from "@/lib/sell/types";

/** What the sheet knows of the entry it is changing that the form cannot say (a course's seats are the owner's own count) and the id it minted for a NEW entry (the same one again is a retry). */
export type SaveExtra = { freshId?: string; /** a NEW saree made from a price list: the fabric read from its name */ fabric?: string; course?: { seats: { state: string; count: number | null }; total: number | null } };
/** What the reading call answers (drafts have ids the web gave them; nothing is saved). */
export type Reading = { entries: SellEntry[]; unclear: boolean; notes: SellNote[] };

/** What the section may ask its server (Owner and Admin; null for the others, who only read). Bound to the workspace by the page. */
export type SellActions = {
  save: (style: SellStyle, id: string | null, form: SellForm[SellStyle], extra?: SaveExtra) => Promise<Reply<{ entry: SellEntry; photosPath: string | null; note: "count" | null }>>;
  remove: (style: SellStyle, id: string) => Promise<Reply<{ id: string }>>;
  understand: (style: SellStyle, text: string) => Promise<Reply<{ form: SellForm[SellStyle] }>>;
  /** The reading call (a real workspace, not products): the owner's words, or the id of a photo or sheet dropped first. */
  read: (style: SellStyle, request: { kind: "talk"; text: string } | { kind: "photo" | "sheet"; fileId: string }) => Promise<Reply<Reading>>;
  readSheet: (style: SellStyle, from: "photos" | "sheet") => Promise<Reply<{ entries: SellEntry[] }>>;
};
/** What opens the work sheet. */
export type Work = { kind: "say" } | { kind: "add" } | { kind: "edit"; entry: SellEntry } | { kind: "read"; from: "photos" | "sheet" };
