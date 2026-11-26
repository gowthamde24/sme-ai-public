import type { Reply } from "../cc/kit";
import type { ProductsReading } from "@/lib/api/what-you-sell";
import type { SellEntry, SellForm, SellNote, SellStyle } from "@/lib/sell/types";

/** What the sheet knows of the entry it is changing that the form cannot say (a course's seats are the owner's own count) and the id it minted for a NEW entry (the same one again is a retry). */
export type SaveExtra = { freshId?: string; /** a NEW saree made from a price list: the fabric read from its name */ fabric?: string; course?: { seats: { state: string; count: number | null }; total: number | null } };
/** What the reading call answers (drafts have ids the web gave them; nothing is saved). */
export type Reading = { entries: SellEntry[]; unclear: boolean; notes: SellNote[] };

/** What the section may ask its server (Owner and Admin; null for the others, who only read). Bound to the workspace by the page. */
/** A list of the owner's own that an import can go into (the lists feature): its default price column and, when it has one, its Category column with the owner's words. */
export type ImportTarget = { id: string; name: string; priceKey: string | null; categoryKey: string | null; categoryChoices: readonly string[] };
export type SellActions = {
  /** Import into a chosen list: read a file into rows (nothing saved), then save the checked rows. */
  previewList?: (listId: string, fileId: string) => Promise<Reply<{ rows: { name: string; cells: Record<string, string | number | boolean | null> }[]; unclear: boolean }>>;
  commitList?: (listId: string, rows: { name: string; cells: Record<string, string | number | boolean | null> }[]) => Promise<Reply<{ created: number; updated: number }>>;
  save: (style: SellStyle, id: string | null, form: SellForm[SellStyle], extra?: SaveExtra) => Promise<Reply<{ entry: SellEntry; photosPath: string | null; note: "count" | null }>>;
  remove: (style: SellStyle, id: string) => Promise<Reply<{ id: string }>>;
  understand: (style: SellStyle, text: string) => Promise<Reply<{ form: SellForm[SellStyle] }>>;
  /** The reading call (a real workspace, not products): the owner's words, or the id of a photo or sheet dropped first. */
  read: (style: SellStyle, request: { kind: "talk"; text: string } | { kind: "photo" | "sheet"; fileId: string }) => Promise<Reply<Reading>>;
  /** A photo or a PDF of a price list, read for a saree shop's products (C1's products reading). */
  readProducts: (fileId: string) => Promise<Reply<ProductsReading>>;
  readSheet: (style: SellStyle, from: "photos" | "sheet") => Promise<Reply<{ entries: SellEntry[] }>>;
};
/** What opens the work sheet. */
export type Work = { kind: "say" } | { kind: "add" } | { kind: "edit"; entry: SellEntry } | { kind: "read"; from: "photos" | "sheet" };
