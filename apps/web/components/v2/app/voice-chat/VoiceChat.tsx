"use client";

import { X } from "lucide-react";
import * as React from "react";

import { Orb, type OrbState } from "@/components/v2/Orb";
import { browserAudio } from "@/lib/browser-voice/audio-io";
import { VoiceClient, type SocketLike, type Snapshot } from "@/lib/browser-voice/client";
import { VOICE_LANGS, type VoiceLang } from "@/lib/browser-voice/protocol";

import { makeT, type Words } from "../words";
import { primary, quiet, secondary } from "../visits/styles";

export type VoiceChatProps = {
  words?: Words;
  /** `wss://<api>/v1/tenants/{id}/voice-chat`, made on the server from the API's own address. */
  url: string;
  language: VoiceLang;
  languageNames: Record<VoiceLang, string>;
  /** The route that hands over the person's sign-in for the socket's first message (the API's contract); asked before the tap so the tap itself can open the microphone. */
  tokenUrl: string;
  onClose: () => void;
  /** "Type instead": closes this and opens the written Ask panel. */
  onType: () => void;
  /** For tests: the audio and the socket. */
  audioFactory?: typeof browserAudio;
  socketFactory?: (url: string) => SocketLike;
};

const TOKEN_FRESH_MS = 20 * 60_000;

/** The sign-in for the socket, from this app's own route (never from anything the page keeps). */
const askToken = async (tokenUrl: string): Promise<{ ok: true; token: string } | { ok: false }> => {
  try {
    const res = await fetch(tokenUrl, { method: "POST", cache: "no-store", credentials: "same-origin" });
    const json: unknown = res.ok ? await res.json() : null;
    const token = typeof json === "object" && json !== null ? (json as { token?: unknown }).token : null;
    return typeof token === "string" && token.length > 0 ? { ok: true, token } : { ok: false };
  } catch {
    return { ok: false };
  }
};

/**
 * "Talk to your assistant" (job DV, contract-browser-voice.md): the full-screen circle that is a microphone. Tap it and speak, tap it again to stop; it follows the microphone while the assistant listens, thinks (and says when it is looking at the business's records), and
 * ripples with the assistant's voice as it speaks. Live captions of both sides: what you said, what it says; a part of a long answer that is not read aloud is on the screen with a label, and the sources of an answer are listed. Speak while it talks and it
 * stops at once (barge-in). The language can be changed on the way. "Type instead" opens the written assistant. Plain words for every end. The microphone and the socket are made on the tap (a phone allows sound only after one).
 */
export function VoiceChat({ words, url, language, languageNames, tokenUrl, onClose, onType, audioFactory = browserAudio, socketFactory = (u) => new WebSocket(u) as unknown as SocketLike }: VoiceChatProps) {
  const t = makeT(words);
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [lang, setLang] = React.useState<VoiceLang>(language);
  const [tokenFailed, setTokenFailed] = React.useState(false);
  const client = React.useRef<VoiceClient | null>(null);
  const [io, setIo] = React.useState<ReturnType<typeof browserAudio> | null>(null);
  const token = React.useRef<{ value: string; at: number } | null>(null);
  const bottom = React.useRef<HTMLDivElement | null>(null);

  const fetchToken = React.useCallback(async () => {
    const out = await askToken(tokenUrl);
    if (out.ok) token.current = { value: out.token, at: Date.now() };
    setTokenFailed(!out.ok);
  }, [tokenUrl]);
  React.useEffect(() => {
    let alive = true; // the sign-in is asked for before the tap, so the tap itself can open the microphone
    askToken(tokenUrl).then(
      (out) => {
        if (!alive) return;
        if (out.ok) token.current = { value: out.token, at: Date.now() };
        else setTokenFailed(true);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [tokenUrl]);
  React.useEffect(() => () => client.current?.stop(), []);
  React.useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" }); // (no value is returned: React would take it for a clean-up)
  }, [snap?.captions]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        client.current?.stop();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const live = snap !== null && snap.phase !== "ended";
  const tap = async () => {
    if (live) {
      client.current?.stop();
      return;
    }
    if (token.current === null || Date.now() - token.current.at > TOKEN_FRESH_MS) await fetchToken();
    if (token.current === null) return setSnap({ phase: "ended", state: null, step: null, captions: [], sources: [], language: lang, end: "signin", micDenied: false });
    const audio = audioFactory();
    setIo(audio);
    const c = new VoiceClient({ url, token: token.current.value, language: lang, audio, socket: socketFactory, onChange: setSnap });
    client.current = c;
    setSnap(c.snapshot);
    await c.start();
  };
  const switchLanguage = (l: VoiceLang) => {
    setLang(l);
    client.current?.setLanguage(l);
  };

  const orb: OrbState = !live ? "ambient" : snap.phase === "connecting" ? "think" : snap.state === "listening" ? "listen" : snap.state === "speaking" ? "speak" : "think";
  const line = !live ? (snap?.end ? t(`bv.end.${snap.end}` as "bv.end.left") : t("bv.tap")) : snap.phase === "connecting" ? t("bv.connecting") : snap.state === "thinking" ? (snap.step === "looking" ? t("bv.looking") : t("bv.thinking")) : snap.state === "speaking" ? t("bv.speaking") : t("bv.listening");
  const analyser = live && io ? io.analyser(snap.state === "speaking" ? "voice" : "mic") : null;

  return (
    <div role="dialog" aria-modal="true" aria-label={t("bv.title")} data-part="voice-chat" data-state={live ? (snap.state ?? snap.phase) : "idle"} className="fixed inset-0 z-[70] flex flex-col items-center bg-bg px-5 pb-6 pt-4 text-ink">
      <div className="flex w-full items-center justify-between gap-3">
        <div role="group" aria-label={t("bv.lang")} className="flex flex-wrap gap-1.5">
          {VOICE_LANGS.map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => switchLanguage(l)} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${lang === l ? "border-brand-edge bg-brand text-on-brand" : "border-edge text-ink"}`}>
              {languageNames[l]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { client.current?.stop(); onClose(); }} aria-label={t("bv.close")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-edge bg-surface hover:bg-surface-2">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex w-full max-w-xl flex-1 flex-col items-center gap-4 overflow-hidden pt-4">
        <button type="button" onClick={() => void tap()} aria-label={live ? t("bv.tap.stop") : t("bv.tap")} data-voice="orb" className="shrink-0 rounded-full">
          <Orb px={168} state={orb} halo={orb === "listen" || orb === "speak"} analyser={analyser} />
        </button>
        <div aria-live="polite" className="flex max-w-md flex-col items-center gap-1 text-center">
          <p data-voice="line" className="font-display text-xl font-semibold leading-snug [overflow-wrap:anywhere]">{line}</p>
          {live ? <p className="text-sm text-muted">{t("bv.tap.stop")}</p> : null}
          {!live && snap === null ? <p className="text-sm text-muted">{t("bv.mic.why")}</p> : null}
          {snap?.micDenied ? <p role="alert" className="text-sm font-medium text-red-text">{t("bv.mic.denied")}</p> : null}
          {tokenFailed && snap === null ? <p role="alert" className="text-sm font-medium text-red-text">{t("bv.end.signin")}</p> : null}
        </div>

        {snap && snap.captions.length > 0 ? (
          <ul aria-label={t("bv.captions")} data-part="captions" className="flex w-full flex-1 flex-col gap-2 overflow-y-auto">
            {snap.captions.map((c) => (
              <li key={c.id} data-who={c.who} data-final={c.final ? "true" : "false"} data-spoken={c.spoken ? "true" : "false"} className={`max-w-[92%] rounded-2xl px-3.5 py-2 text-base ${c.who === "user" ? "self-end border border-line" : "self-start bg-surface-2"} ${c.final ? "" : "opacity-70"}`}>
                <span className="block text-xs font-semibold text-muted">{c.who === "user" ? t("bv.you") : t("bv.assistant")}</span>
                {c.text}
                {c.who === "assistant" && !c.spoken ? <span className="mt-1 block text-xs font-semibold text-muted">{t("bv.notspoken")}</span> : null}
              </li>
            ))}
            <div ref={bottom} />
          </ul>
        ) : null}
        {snap && snap.sources.length > 0 ? (
          <div data-part="sources" className="w-full">
            <p className="text-xs font-semibold text-muted">{t("bv.sources")}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {snap.sources.map((s) => (
                <li key={s.label} className="rounded-full border border-line px-2.5 py-1 text-sm">
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2 pt-3">
        <button type="button" onClick={() => void tap()} className={live ? secondary : primary}>
          {live ? t("bv.tap.stop") : t("bv.tap")}
        </button>
        <button type="button" onClick={() => { client.current?.stop(); onType(); }} className={quiet}>
          {t("bv.type")}
        </button>
      </div>
    </div>
  );
}
