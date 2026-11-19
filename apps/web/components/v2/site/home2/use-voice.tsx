"use client";

import * as React from "react";

import { loadManifest, playClip, playable, type Manifest } from "./voice";

export type Voice = {
  manifest: Manifest | null;
  /** The visitor turned the sound on (it stays on for the next lines of the same part). */
  on: boolean;
  playing: boolean;
  toggle: () => void;
  /** Says one clip, if it may be heard (a reviewed clip with a file); `onWord(i)` lights word i. Resolves false when it was not played (the words then run on their timers). */
  play: (id: string, onWord: (i: number) => void) => Promise<boolean>;
  stop: () => void;
};

/**
 * One part's voice (the hero, a sample call, the stand-up). The manifest is a small file read once the page is idle, so a "Hear it" button is drawn only for a clip that may be heard; the sound files themselves load on the first tap.
 * A clip the manifest marks `draft` (waiting for a native speaker) gets no button and is never played: its words run silently (owner, 6 Nov 2026). Client only.
 */
export function useVoice(): Voice {
  const [manifest, setManifest] = React.useState<Manifest | null>(null);
  const [on, setOn] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const handle = React.useRef<{ stop?: () => void }>({});
  React.useEffect(() => {
    let live = true;
    const h = handle.current;
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500));
    idle(() => void loadManifest().then((m) => live && setManifest(m)));
    return () => {
      live = false;
      h.stop?.();
    };
  }, []);
  const stop = React.useCallback(() => {
    handle.current.stop?.();
    setPlaying(false);
  }, []);
  const play = React.useCallback(
    async (id: string, onWord: (i: number) => void) => {
      if (!playable(manifest, id) || !manifest) return false;
      handle.current.stop?.();
      setPlaying(true);
      await playClip(manifest.clips[id], onWord, handle.current);
      setPlaying(false);
      return true;
    },
    [manifest],
  );
  const toggle = React.useCallback(() => {
    setOn((v) => {
      if (v) handle.current.stop?.();
      return !v;
    });
  }, []);
  return { manifest, on, playing, toggle, play, stop };
}

/** "Hear it" / "Sound on": drawn only when the clip shown now may be heard (never for a draft; nothing says "draft"). */
export function HearIt({ voice, id, w, label = "h2.hear" }: { voice: Voice; id: string; w: Readonly<Record<string, string>>; label?: string }) {
  if (!playable(voice.manifest, id)) return null;
  return (
    <button type="button" onClick={voice.toggle} aria-pressed={voice.on} data-hear={id} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold ${voice.on ? "bg-ink text-bg" : "text-brand-text hover:bg-brand-bg"}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
      </svg>
      {voice.on ? w["h2.hear.on"] : w[label]}
    </button>
  );
}
