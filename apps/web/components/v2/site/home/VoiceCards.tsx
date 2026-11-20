"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";

import { Swipe } from "./Swipe";

export type VoiceCard = {
  id: string;
  /** the business, in the page's language */
  biz: string;
  /** the sample's language: its name in the page's language, and its code (the transcript is in this language) */
  langName: string;
  lang: string;
  /** the words the voice says (the clip's own text; the card shows its first two lines) and its length in seconds */
  text: string;
  seconds: number;
  sources: { src: string; type: string }[];
};
const clock = (s: number) => `0:${String(Math.max(1, Math.round(s))).padStart(2, "0")}`;
type Words = { play: string; stop: string; playing: string; dot: string; region: string };

/**
 * "Hear our voices": four sample voices in a row, each a round play button with its length, the language and the business, and two lines of its words underneath. ONE audio element for the whole row: starting a sample stops the one before; nothing plays by itself;
 * the files are the site's own (public/audio/site), so no outside address is ever asked. Without JavaScript the transcript still reads, and a plain audio player is drawn in its place (the noscript).
 */
export function VoiceCards({ items, w }: { items: VoiceCard[]; w: Words }) {
  const audio = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(0);
  const stop = React.useCallback(() => {
    const a = audio.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setPlaying(null);
    setDone(0);
  }, []);
  const toggle = (c: VoiceCard) => {
    const a = audio.current;
    if (!a) return;
    if (playing === c.id) {
      stop();
      return;
    }
    const pick = c.sources.find((s) => a.canPlayType(s.type) !== "") ?? c.sources[c.sources.length - 1];
    if (!pick) return;
    a.src = pick.src;
    setDone(0);
    setPlaying(c.id);
    a.play().catch(() => setPlaying(null));
  };
  React.useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const tick = () => setDone(a.duration > 0 ? a.currentTime / a.duration : 0);
    const end = () => {
      setPlaying(null);
      setDone(0);
    };
    a.addEventListener("timeupdate", tick);
    a.addEventListener("ended", end);
    a.addEventListener("error", end);
    return () => {
      a.removeEventListener("timeupdate", tick);
      a.removeEventListener("ended", end);
      a.removeEventListener("error", end);
    };
  }, []);
  // a sample stops when the visitor leaves the page's voices behind (the page closing is the browser's own)
  React.useEffect(() => stop, [stop]);
  return (
    <div data-part="voices">
      <audio ref={audio} preload="none" className="h4-audio-off" />
      <Swipe label={w.region} dotWord={w.dot}>
        {items.map((c) => {
          const on = playing === c.id;
          const name = `${c.langName}, ${c.biz}`;
          return (
            <article key={c.id} className="h4-card h4-voice" data-voice={c.id} data-playing={on ? "" : undefined}>
              <div className="h4-voice-top">
                <button type="button" className="h4-play" aria-pressed={on} aria-label={`${on ? w.stop : w.play}: ${name}`} onClick={() => toggle(c)}>
                  {on ? <Pause size={20} strokeWidth={2.4} aria-hidden="true" /> : <Play size={20} strokeWidth={2.4} aria-hidden="true" className="h4-play-ico" />}
                </button>
                <p className="h4-voice-meta">
                  <b className="h4-voice-lang">
                    {c.langName} · {c.biz}
                  </b>
                  <span className="h4-voice-state" aria-live="polite">
                    {on ? w.playing : clock(c.seconds)}
                  </span>
                </p>
              </div>
              <span className="h4-voice-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${on ? done : 0})` }} />
              </span>
              <p className="h4-voice-says" lang={c.lang} data-part="transcript">
                {c.text}
              </p>
              <noscript>
                <audio controls preload="none" src={c.sources[c.sources.length - 1]?.src} aria-label={name} />
              </noscript>
            </article>
          );
        })}
      </Swipe>
    </div>
  );
}
