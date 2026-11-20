/**
 * THE SAMPLE VOICES of the job templates (contract 1.1 part 1, section 1 item 5 and section 8 item 1): `preview.sample_audio` is `null` or `{te?, en?, hi?, kn?}`, each language a path on the API's own site,
 * EXACTLY `/v1/job-samples/{pack}/{id}.{lang}.mp3`. The web never plays the API's address: it plays the same path on OUR site (`/job-samples/{pack}/{id}.{lang}.mp3`, the route handler app/job-samples/[pack]/[file]/route.ts streams it),
 * so no cookie or address of the API reaches the browser and the page's security policy stays as it is. Pure: no request API, so the parser, the route and the player share one set of rules.
 */
export const SAMPLE_LANGS = ["te", "en", "hi", "kn"] as const;
export type SampleLang = (typeof SAMPLE_LANGS)[number];
/** One playable link per language that has a sample (the web's own path, see above). */
export type SampleAudio = Partial<Record<SampleLang, string>>;

/** A pack id and a template id: snake_case, no dot, no slash, no backslash, no percent. */
const PACK = /^[a-z][a-z0-9_]{0,39}$/;
const ID = /^[a-z][a-z0-9_]{0,79}$/;
/** The file of a sample: `{id}.{lang}.mp3`. */
const FILE = /^([a-z][a-z0-9_]{0,79})\.(te|en|hi|kn)\.mp3$/;
/** What the API sends: that exact shape and nothing else (no `//`, no `\`, no scheme, no host, no query, no `..`). */
const API_PATH = /^\/v1\/job-samples\/([a-z][a-z0-9_]{0,39})\/([a-z][a-z0-9_]{0,79})\.(te|en|hi|kn)\.mp3$/;

export const isSamplePack = (v: string): boolean => PACK.test(v);
export const isSampleFile = (v: string): boolean => FILE.test(v);
export const isSampleId = (v: string): boolean => ID.test(v);

/** The path on OUR site for a pack and a file, or null when either is not the strict shape. */
export function sampleSrc(pack: string, file: string): string | null {
  return PACK.test(pack) && FILE.test(file) ? `/job-samples/${pack}/${file}` : null;
}

/** The API's path for a pack and a file (what the route handler asks), or null when either is not the strict shape. */
export function apiSamplePath(pack: string, file: string): string | null {
  return PACK.test(pack) && FILE.test(file) ? `/v1/job-samples/${pack}/${file}` : null;
}

/** One API path -> `{lang, src}` on our site, or null when it is not exactly the contract's shape. */
export function readSamplePath(v: unknown): { lang: SampleLang; src: string } | null {
  if (typeof v !== "string" || v.length > 200) return null;
  const m = API_PATH.exec(v);
  return m ? { lang: m[3] as SampleLang, src: `/job-samples/${m[1]}/${m[2]}.${m[3]}.mp3` } : null;
}

/**
 * The language to play: the person's, then the business's own (the language it talks to customers in), then Telugu, then English; null = this template has no sample in any of them (no player is drawn).
 * Only languages that have a sample are chosen.
 */
export function pickSample(audio: SampleAudio | null, personLang: string, businessLang: string | null): string | null {
  if (!audio) return null;
  for (const lang of [personLang, businessLang, "te", "en"]) {
    if (lang && (SAMPLE_LANGS as readonly string[]).includes(lang)) {
      const src = audio[lang as SampleLang];
      if (src) return src;
    }
  }
  return null;
}
