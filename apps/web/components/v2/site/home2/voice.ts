/**
 * The site's real voices (landing v2, part F1 by C1: apps/web/public/audio/site/, manifest.json). Nothing loads until the visitor taps a "Hear it" button: then the manifest, then only the clips played.
 *
 * Owner rule (6 Nov 2026): a clip still waiting for a native speaker's review is `draft: true` in the manifest. It gets NO "Hear it" (its words still run silently, word by word), and the site never shows the word "draft" to a visitor.
 * The owner switches a clip on after review by setting its `draft` to false in the manifest: no code changes. Client only.
 */
export type ClipWord = { w: string; start: number; end: number };
export type Clip = { group: string; speaker: string; lang: string; draft: boolean; text: string; duration: number; words: ClipWord[]; sources: { src: string; type: string }[] };
export type Manifest = { version: number; groups: Record<string, string[]>; clips: Record<string, Clip> };

const MANIFEST = "/audio/site/manifest.json";
let pending: Promise<Manifest | null> | null = null;

export function parseManifest(json: unknown): Manifest | null {
  if (typeof json !== "object" || json === null) return null;
  const m = json as Partial<Manifest>;
  if (typeof m.groups !== "object" || m.groups === null || typeof m.clips !== "object" || m.clips === null) return null;
  const clips: Record<string, Clip> = {};
  for (const [id, c] of Object.entries(m.clips)) {
    if (!/^[a-z0-9-]{1,40}$/.test(id) || typeof c !== "object" || c === null) continue;
    const sources = Array.isArray(c.sources) ? c.sources.filter((s) => typeof s?.src === "string" && s.src.startsWith("/audio/site/") && !s.src.includes("..") && typeof s.type === "string") : [];
    const words = Array.isArray(c.words) ? c.words.filter((w) => typeof w?.w === "string" && Number.isFinite(w.start) && Number.isFinite(w.end)) : [];
    // a clip is playable only when the manifest says, in so many words, that it is not a draft
    clips[id] = { group: String(c.group ?? ""), speaker: String(c.speaker ?? ""), lang: String(c.lang ?? ""), draft: c.draft !== false, text: String(c.text ?? ""), duration: Number(c.duration) || 0, words, sources };
  }
  const groups: Record<string, string[]> = {};
  for (const [g, ids] of Object.entries(m.groups)) if (Array.isArray(ids)) groups[g] = ids.filter((i): i is string => typeof i === "string" && i in clips);
  return { version: Number(m.version) || 0, groups, clips };
}

/** The manifest (once per page; null when it cannot be read: every "Hear it" then stays hidden). */
export function loadManifest(): Promise<Manifest | null> {
  pending ??= fetch(MANIFEST, { credentials: "same-origin" })
    .then((r) => {
      if (r.ok) return r.json();
      // a missing manifest is the site's large 404 page: cancel it, or the browser keeps the unread answer open (the page never goes quiet)
      void r.body?.cancel().catch(() => undefined);
      return null;
    })
    .then(parseManifest)
    .catch(() => null);
  return pending;
}
/** May this clip be heard? Only a clip the manifest marks `draft: false`, with a sound file. */
export const playable = (m: Manifest | null, id: string): boolean => {
  const c = m?.clips[id];
  return !!c && !c.draft && c.sources.length > 0;
};

/** Plays one clip; `onWord(i)` lights word i as the voice says it; resolves when it ends (or fails). Returns a stop function through `handle`. */
export function playClip(clip: Clip, onWord: (i: number) => void, handle: { stop?: () => void }): Promise<void> {
  return new Promise((resolve) => {
    const probe = document.createElement("audio");
    const src = clip.sources.find((s) => probe.canPlayType(s.type) !== "") ?? clip.sources[1] ?? clip.sources[0];
    if (!src) return resolve();
    const audio = new Audio(src.src);
    let raf = 0;
    const tick = () => {
      const t = audio.currentTime;
      let i = -1;
      for (let k = 0; k < clip.words.length; k++) if (t >= clip.words[k].start) i = k;
      onWord(i);
      raf = requestAnimationFrame(tick);
    };
    const done = () => {
      cancelAnimationFrame(raf);
      onWord(clip.words.length - 1);
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    handle.stop = () => {
      audio.pause();
      done();
    };
    audio.play().then(() => (raf = requestAnimationFrame(tick)), done);
  });
}
