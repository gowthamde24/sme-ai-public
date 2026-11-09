"use client";

import * as React from "react";

/**
 * The stand-up's sound for the scene (app v4 part 7): the same route as the card (`/ai-team/standup-audio`, fetched with the person's token on the server, played from memory), plus where the sound is (0 to 1) so the words can
 * be followed. `reset()` forgets the sound (after "Make it again" the old one is not the stand-up's any more).
 */
export function useStandupAudio(base: string, date: string) {
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [fraction, setFraction] = React.useState(0);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const url = React.useRef<string | null>(null);

  const forget = React.useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPlaying(false);
    setFraction(0);
  }, []);
  React.useEffect(() => forget, [forget]);
  // another day's stand-up is another sound
  React.useEffect(() => forget, [date, forget]);

  const toggle = React.useCallback(async () => {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    setFailed(false);
    try {
      if (!audio.current) {
        setLoading(true);
        const r = await fetch(`${base}/ai-team/standup-audio?${new URLSearchParams({ date }).toString()}`, { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        url.current = URL.createObjectURL(await r.blob());
        const a = new Audio(url.current);
        a.ontimeupdate = () => setFraction(a.duration > 0 ? a.currentTime / a.duration : 0);
        a.onended = () => {
          setPlaying(false);
          setFraction(0);
        };
        audio.current = a;
        setLoading(false);
      }
      await audio.current.play();
      setPlaying(true);
    } catch {
      setLoading(false);
      setPlaying(false);
      setFailed(true);
    }
  }, [base, date, playing]);

  return { playing, loading, failed, fraction, toggle, reset: forget };
}
