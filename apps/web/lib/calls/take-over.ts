import type { AudioIO, SocketLike } from "@/lib/browser-voice/client";

/**
 * Take over a live call from the app (app v4 part 4; C1 #398, docs/contracts/calls.md "Take over a live call from the app"): the Owner or an Admin talks to the caller from the browser while the assistant is quiet, then hands the call back.
 * The WebSocket takes the person's sign-in in its FIRST message (a browser socket cannot send a header); then the caller's audio arrives as binary 16 kHz mono PCM16 frames and the microphone goes out the same way.
 * `hand_back` (or closing the socket) gives the call back to the assistant; `ended` = the call itself is over; `error` carries a closed code and the socket closes. Nothing is recorded. CLIENT ONLY; the socket and the audio
 * are handed in, so this is tested with fakes.
 *
 * The microphone opens first, on the person's tap (a phone's audio only starts after one), and nothing is sent until the server says `ready`: a refused microphone never opens the socket.
 */
export const TAKE_OVER_RATE = 16_000;
export type TakeOverPhase = "idle" | "connecting" | "on" | "back" | "ended" | "error";
export const TAKE_OVER_ERRORS = ["mic", "unauthorized", "forbidden", "not_found", "call_not_here", "unavailable", "down"] as const;
export type TakeOverError = (typeof TAKE_OVER_ERRORS)[number];
export type TakeOverState = { phase: TakeOverPhase; error: TakeOverError | null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const SERVER_ERRORS: readonly TakeOverError[] = ["unauthorized", "forbidden", "not_found", "call_not_here", "unavailable"];

/** The socket's address, from the API's own https address (never from anything the browser holds). null for anything that is not a plain http(s) address. */
export function takeOverSocketUrl(apiBase: string, tenantId: string, callId: string): string | null {
  try {
    const u = new URL(apiBase);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}/v1/tenants/${encodeURIComponent(tenantId)}/calls/${encodeURIComponent(callId)}/take-over`;
  } catch {
    return null;
  }
}

export function startTakeOver(o: { url: string; token: () => Promise<string | null>; audio: AudioIO; socket: (url: string) => SocketLike; onChange: (s: TakeOverState) => void }): { handBack: () => void; stop: () => void } {
  let ws: SocketLike | null = null;
  let ready = false;
  let done = false;
  const set = (phase: TakeOverPhase, error: TakeOverError | null = null) => o.onChange({ phase, error });
  const finish = (phase: TakeOverPhase, error: TakeOverError | null = null) => {
    if (done) return;
    done = true;
    ready = false;
    o.audio.close();
    if (ws && ws.readyState <= 1) ws.close(1000);
    set(phase, error);
  };
  set("connecting");
  void (async () => {
    try {
      await o.audio.startMic((pcm) => {
        if (ready && ws && ws.readyState === 1) ws.send(pcm);
      });
    } catch {
      return finish("error", "mic");
    }
    if (done) return;
    const token = await o.token();
    if (!token) return finish("error", "unauthorized");
    if (done) return;
    ws = o.socket(o.url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws?.send(JSON.stringify({ type: "start", access_token: token }));
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        if (ready) o.audio.play(event.data);
        return;
      }
      let msg: unknown = null;
      try {
        msg = typeof event.data === "string" ? JSON.parse(event.data) : null;
      } catch {
        return;
      }
      if (!isRec(msg)) return;
      if (msg.type === "ready") {
        ready = true;
        set("on");
      } else if (msg.type === "ended") finish("ended");
      else if (msg.type === "error") finish("error", (SERVER_ERRORS as readonly unknown[]).includes(msg.code) ? (msg.code as TakeOverError) : "down");
    };
    ws.onerror = () => finish("error", "down");
    // closed by the server without a word: the call has gone back to the assistant (or ended); said as "down" if it never got going
    ws.onclose = () => finish(ready ? "back" : "error", ready ? null : "down");
  })();
  return {
    handBack: () => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "hand_back" }));
      finish("back");
    },
    stop: () => finish("back"),
  };
}
