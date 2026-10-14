import type { Colour, Fabric, Item, Occasion, Photo, PriceBand, StockStatus, Zari } from "@/lib/api/catalogue";

/**
 * What the add/edit form asks of the server and what it gets back (job BC). A refusal carries OUR sentence (never text from the API): `mfa` = the second factor is missing (the form points at the Security
 * page), `stale` = the screen is out of date.
 */
export type Refused = { ok: false; error: string; mfa?: boolean; stale?: boolean };

export type SaveInput = {
  name: string;
  fabric: Fabric;
  colours: Colour[];
  zari: Zari;
  border: string | null;
  occasions: Occasion[];
  priceBand: PriceBand;
  stockStatus: StockStatus;
  active: boolean;
  /** Absent = keep the exact price. Only the Owner's form ever sends it. */
  price?: { rupees: number } | { clear: true };
};
export type ItemOutcome = { ok: true; item: Item } | Refused;

export type EditorActions = {
  /** The extra fields of the business type (job CL), kept after the details are saved. Absent where the business type has none. */
  saveCustom?: (itemId: string, values: Record<string, import("@/lib/api/custom-fields").CustomValue>) => Promise<{ ok: true } | { ok: false; error: string }>;
  save: (itemId: string, input: SaveInput) => Promise<ItemOutcome>;
  remove: (photoId: string) => Promise<ItemOutcome>;
  reorder: (itemId: string, photoIds: string[]) => Promise<ItemOutcome>;
};

/** The answer of the upload route: the photo that was stored and every live photo of the item after it (fresh links). `code` is the API's closed code, or `network` / `aborted` / `bad_answer` from the browser's side. */
export type UploadResult = { ok: true; photo: Photo; photos: Photo[] } | { ok: false; code: string };
export type Uploader = (file: Blob, photoId: string, onProgress: (percent: number) => void) => Promise<UploadResult>;

/** A customer found by the lead search. Nothing but the names and the last four digits: the number never reaches the browser. */
export type LeadChoice = { leadId: string; customer: string | null; city: string | null; contactName: string | null; phoneLast4: string | null };
export type LeadSearchOutcome = { ok: true; items: LeadChoice[] } | Refused;

export type SendInput = { messageId: string; itemId: string; leadId: string; photoIds: string[]; text: string; language: string; keepRecord: boolean };
export type SendOutcome =
  | { ok: true; state: "sent" | "queued" | "needs_approval" | "blocked"; text: string; why: string | null; recordText: string }
  | Refused;
export type SendActions = {
  search: (query: string) => Promise<LeadSearchOutcome>;
  send: (input: SendInput) => Promise<SendOutcome>;
};
