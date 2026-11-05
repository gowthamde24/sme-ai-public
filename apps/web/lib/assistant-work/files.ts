/**
 * The chat's files (job assistant-does-the-work, C2): what the "+" menu and drag-and-drop accept, the size and count limits, and the honest "can't do yet" card for a file the chat cannot read yet.
 * On their own (lib/assistant-work/types.ts re-exports them), so the chat in every page's first load does not carry the cards' parsers.
 */

// ---- files in the chat ------------------------------------------------------------------------------------------------

/**
 * What the "+" menu and drag-and-drop accept: the contract's kinds (section 1). sheet = Excel, CSV, TSV, OpenDocument; pdf; image = JPG, PNG, HEIC/HEIF (a phone's photo); doc = Word (.docx);
 * contacts = a contact card (.vcf); text. Today only sheets, contact cards and text become leads: a PDF, a photo or a Word file is answered with "can't do yet" (`cant_do`, `not_yet`).
 */
export const FILE_EXTENSIONS = [".xlsx", ".xls", ".csv", ".tsv", ".ods", ".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".docx", ".vcf", ".txt"] as const;

const KIND_OF_EXT: Readonly<Record<string, FileKind>> = { xlsx: "sheet", xls: "sheet", csv: "sheet", tsv: "sheet", ods: "sheet", pdf: "pdf", jpg: "image", jpeg: "image", png: "image", heic: "image", heif: "image", docx: "doc", vcf: "contacts", txt: "text" };
/** The browser's type of each kind, for a file whose name has NO extension (a phone's camera or share sheet): the extension, when there is one, always decides. */
const KIND_OF_TYPE: Readonly<Record<string, FileKind>> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.ms-excel": "sheet",
  "application/vnd.oasis.opendocument.spreadsheet": "sheet",
  "text/csv": "sheet",
  "text/tab-separated-values": "sheet",
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
  "image/heic": "image",
  "image/heif": "image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
  "text/vcard": "contacts",
  "text/x-vcard": "contacts",
  "text/plain": "text",
};
/** The `accept` of the file picker: the extensions and their usual types (a phone's picker filters by type). */
export const FILE_ACCEPT = [...FILE_EXTENSIONS, ...Object.keys(KIND_OF_TYPE)].join(",");
/** 10 MB (the contract: the API's request limit is 20 MB and base64 is 4/3 bigger), checked in the browser BEFORE anything is uploaded (the API checks again). */
export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
/** At most this many files wait beside one message (the contract: 5 per message). */
export const MAX_FILES = 5;

export const FILE_KINDS = ["sheet", "pdf", "image", "doc", "contacts", "text"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
/** The kinds the assistant cannot read yet (the contract: pdf, image, doc -> `cant_do`, `not_yet`). */
export const NOT_YET_KINDS: readonly FileKind[] = ["pdf", "image", "doc"];

/**
 * The kind of a file, or null when it is not one the chat takes. The extension decides (a browser's type is often EMPTY for .heic, .heif, .vcf and .xls); only a name without any extension is
 * judged by the browser's type. A name with an extension the chat does not take (.exe, .xlsm, .doc) is refused whatever its type says. The API decides again by the first bytes.
 */
export function fileKindOf(name: string, type?: string | null): FileKind | null {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot > 0) return KIND_OF_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
  const t = (type ?? "").split(";")[0].trim().toLowerCase();
  return KIND_OF_TYPE[t] ?? null;
}

/** Why a file was not taken, before any upload. */
export type FileRefusal = "type" | "size" | "empty" | "count";

/** The check the chat makes before an upload starts. */
export function checkFile(file: { name: string; size: number; type?: string }, waiting: number): FileRefusal | null {
  if (waiting >= MAX_FILES) return "count";
  if (fileKindOf(file.name, file.type) === null) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > MAX_FILE_BYTES) return "size";
  return null;
}

/** "1.2 MB", "340 KB", "900 B": the size on a chip, in digits every language reads. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** The honest "can't do yet" card for a file the chat cannot read yet, made in the browser in mock mode (`n` keeps each card's id its own). Here, not in the fixtures, so the chat does not load them. */
export const notYetFileJson = (n: number, what: string, label: string) => ({ kind: "cant_do", id: `e3000000-0000-4000-8000-${String(n).padStart(12, "0")}`, reason: "not_yet", what, screen: { label, href: "/settings/knowledge" } });
