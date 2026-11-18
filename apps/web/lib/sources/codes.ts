/**
 * Lead-source card words as codes (C1 #832, 18 Nov 2026; docs/contracts/lead-sources-v2.md): every card carries `text`, and for each English sentence a reference `{code, params}` (or null). This app holds the words (`scc.<code>`) in each language;
 * a code it does not know falls back to the API's English sentence, so a newer API never shows a blank or a raw code. `params` carries `n` (a count) only.
 */
export type Ref = { code: string; n: number | null };
export type CardCodes = { detail: Ref | null; problemMessage: Ref | null; testLabel: Ref | null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readRef(v: unknown): Ref | null {
  if (!isRec(v) || typeof v.code !== "string" || !/^[a-z0-9_.]{1,60}$/.test(v.code)) return null;
  const n = isRec(v.params) && typeof v.params.n === "number" && Number.isFinite(v.params.n) && v.params.n >= 0 ? Math.trunc(v.params.n) : null;
  return { code: v.code, n };
}

export function readCodes(text: unknown): CardCodes {
  const t = isRec(text) ? text : {};
  return { detail: readRef(t.detail), problemMessage: readRef(t.problem_message), testLabel: readRef(t.test_label) };
}

/** The sentence in the person's language when this app knows the code (a `{n}` filled), else the English the API sent. */
export function refText(words: Readonly<Record<string, string>> | undefined, ref: Ref | null | undefined, english: string | null): string | null {
  const known = ref ? words?.[`scc.${ref.code}`] : undefined;
  if (!ref || known === undefined) return english;
  return ref.n === null ? known : known.replace(/\{n\}/g, String(ref.n));
}
