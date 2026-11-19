import type { Reply } from "../cc/kit";
import type { SellEntry, SellForm, SellStyle } from "@/lib/sell/types";

/** What the section may ask its server (Owner and Admin; null for the others, who only read). Bound to the workspace by the page. */
export type SellActions = {
  save: (style: SellStyle, id: string | null, form: SellForm[SellStyle]) => Promise<Reply<{ entry: SellEntry; photosPath: string | null; note: "count" | null }>>;
  understand: (style: SellStyle, text: string) => Promise<Reply<{ form: SellForm[SellStyle] }>>;
  readSheet: (style: SellStyle, from: "photos" | "sheet") => Promise<Reply<{ entries: SellEntry[] }>>;
};
/** What opens the work sheet. */
export type Work = { kind: "say" } | { kind: "add" } | { kind: "edit"; entry: SellEntry } | { kind: "read"; from: "photos" | "sheet" };
