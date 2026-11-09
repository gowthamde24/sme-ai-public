"use client";

import * as React from "react";

import { browserAudio } from "@/lib/browser-voice/audio-io";
import { VoiceClient, type AudioIO, type Snapshot, type SocketLike } from "@/lib/browser-voice/client";
import { isVoiceLang } from "@/lib/browser-voice/protocol";
import { askVoiceToken } from "@/lib/browser-voice/token";

import { alertBox, btnMain, btnQuiet, fieldHelp } from "../ui";

type W = Readonly<Record<string, string>>;

/**
 * A practice call BY VOICE (app v4 part 4, C1 #402): the Owner talks as a customer and hears the phone assistant exactly as a caller would, on the Live talk socket in `practice_call` mode (the saved training, the inbound opening
 * line, the call's rules; Sarvam's voice). Nothing is stored; it counts as Live talk time. The microphone opens on the tap; the captions show as it goes; End stops it. The audio and the socket can be handed in for tests.
 */
export function VoicePractice({ w, url, tokenUrl, language, unsaved, audioFactory, socketFactory }: { w: W; url: string; tokenUrl: string; language: string; unsaved: boolean; audioFactory?: () => AudioIO; socketFactory?: (u: string) => SocketLike }) {
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [failed, setFailed] = React.useState<"signin" | null>(null);
  const client = React.useRef<VoiceClient | null>(null);
  React.useEffect(() => () => client.current?.stop(), []);
  const lang = isVoiceLang(language) ? language : "en";
  const start = async () => {
    setFailed(null);
    const t = await askVoiceToken(tokenUrl);
    if (!t.ok) return setFailed("signin");
    const c = new VoiceClient({ url, token: t.token, language: lang, mode: "practice_call", sttLanguage: lang, audio: (audioFactory ?? (() => browserAudio()))(), socket: socketFactory ?? ((u) => new WebSocket(u) as unknown as SocketLike), onChange: setSnap });
    client.current = c;
    setSnap(c.snapshot); // "Connecting…" and End at once, before the API answers
    await c.start();
  };
  const on = snap !== null && snap.phase !== "ended";
  const end = snap?.phase === "ended" ? snap.end : null;
  const status = !snap ? null : snap.phase === "connecting" ? w["tt.voice.connecting"] : snap.state === "speaking" ? w["tt.voice.speaking"] : snap.state === "thinking" ? w["tt.voice.thinking"] : w["tt.voice.listening"];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3" data-part="tt-voice">
      <p className={`${fieldHelp} m-0`}>{w["tt.voice.help"]}</p>
      {unsaved && !on ? <p className="m-0 text-sm font-semibold text-brand-text">{w["tt.voice.unsaved"]}</p> : null}
      {on ? (
        <>
          <p role="status" className="m-0 text-sm font-semibold text-brand-text">
            {status}
          </p>
          {snap.captions.length ? (
            <ol aria-live="polite" className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm" data-part="tt-voice-captions">
              {snap.captions.slice(-6).map((c) => (
                <li key={c.id} data-who={c.who} className={c.who === "user" ? "self-end text-ink" : "self-start text-muted"}>
                  <span lang={lang}>{c.text}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <button type="button" className={`${btnQuiet} self-start`} onClick={() => client.current?.stop()}>
            {w["tt.voice.stop"]}
          </button>
        </>
      ) : (
        <button type="button" className={`${btnMain} self-start`} onClick={() => void start()}>
          {w["tt.voice.start"]}
        </button>
      )}
      <p className="m-0 text-sm text-muted" data-part="tt-voice-honest">
        {w["tt.voice.honest"]}
      </p>
      {snap?.micDenied ? (
        <p role="alert" className={alertBox}>
          {w["tt.voice.mic"]}
        </p>
      ) : failed ? (
        <p role="alert" className={alertBox}>
          {w["tt.voice.signin"]}
        </p>
      ) : end ? (
        end === "left" || end === "goodbye" || end === "idle" || end === "session" ? (
          <p role="status" className="m-0 text-sm text-muted">
            {w["tt.voice.ended"]}
          </p>
        ) : (
          <p role="alert" className={alertBox}>
            {w[`bv.end.${end}`] ?? w["tt.voice.ended"]}
          </p>
        )
      ) : null}
    </div>
  );
}
