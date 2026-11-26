/**
 * The first sheet of an Excel file (.xlsx) as rows of text, read in the browser with no library and no upload: an .xlsx is a zip of small XML files; the browser's own `DecompressionStream` unpacks them. Only what a price list needs: text and numbers.
 * Anything it cannot read (an old .xls, a password, a damaged file) throws `XlsxError`, and the page says so in plain words.
 */
export class XlsxError extends Error {}

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const body = new Response(data as BodyInit).body;
  if (!body) throw new XlsxError("no stream");
  return new Uint8Array(await new Response(body.pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}

/** name -> bytes of every file in the zip (the central directory is the list; the local header says where the data starts). */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const d = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(d, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("not a zip");
  const count = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const text = new TextDecoder();
  for (let n = 0; n < count && n < 500; n++) {
    if (u32(d, p) !== 0x02014b50) throw new XlsxError("bad zip");
    const method = u16(d, p + 10);
    const size = u32(d, p + 20);
    const nameLen = u16(d, p + 28);
    const extraLen = u16(d, p + 30);
    const commentLen = u16(d, p + 32);
    const local = u32(d, p + 42);
    const name = text.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) continue;
    if (u32(d, local) !== 0x04034b50) throw new XlsxError("bad zip");
    const start = local + 30 + u16(d, local + 26) + u16(d, local + 28);
    const raw = bytes.subarray(start, start + size);
    out.set(name, method === 0 ? raw : method === 8 ? await inflate(raw) : (() => { throw new XlsxError("method"); })());
  }
  return out;
}

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function xlsxCells(buf: ArrayBuffer): Promise<string[][]> {
  let files: Map<string, Uint8Array>;
  try {
    files = await unzip(buf);
  } catch (e) {
    throw e instanceof XlsxError ? e : new XlsxError("unreadable");
  }
  const dec = new TextDecoder();
  const xml = (b: Uint8Array) => new DOMParser().parseFromString(dec.decode(b), "application/xml");
  const sheetName = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))[0];
  if (!sheetName) throw new XlsxError("no sheet");
  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) for (const si of Array.from(xml(ss).getElementsByTagName("si"))) shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
  const rows: string[][] = [];
  for (const row of Array.from(xml(files.get(sheetName)!).getElementsByTagName("row")).slice(0, 2000)) {
    const line: string[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const text = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("") : v;
      line[colIndex(c.getAttribute("r") ?? "A1")] = text.trim();
    }
    rows.push(Array.from(line, (x) => x ?? ""));
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}
