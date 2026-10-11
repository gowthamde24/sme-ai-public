/**
 * Playing the spoken answer (job BF). The audio arrives as base64 in the stream; it is turned into a Blob and played from a `blob:` address of this page (the page's policy allows media from `self` and
 * `blob:` only). The player is one object per answer: play, stop, and let go of the address when done. Browsers may refuse to start sound without a tap; `play()` then says false and the box shows its
 * Play button instead.
 */
export type AnswerPlayer = {
  /** Starts the sound. True when it is playing; false when the browser would not start it (or the audio is unreadable). */
  play(): Promise<boolean>;
  stop(): void;
  /** Stops and lets go of the blob address. The player cannot be used again. */
  dispose(): void;
};

/** `onChange` is called with true when the sound starts and false when it ends, is stopped or fails. */
export function makeAnswerPlayer(contentType: string, base64: string, onChange: (playing: boolean) => void): AnswerPlayer | null {
  let url: string;
  try {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  } catch {
    return null;
  }
  const audio = new Audio(url);
  let disposed = false;
  audio.addEventListener("ended", () => onChange(false));
  audio.addEventListener("error", () => onChange(false));
  audio.addEventListener("pause", () => onChange(false));
  return {
    async play() {
      if (disposed) return false;
      try {
        await audio.play();
        onChange(true);
        return true;
      } catch {
        onChange(false);
        return false;
      }
    },
    stop() {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // nothing is playing
      }
      onChange(false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        audio.pause();
      } catch {
        // nothing is playing
      }
      URL.revokeObjectURL(url);
      onChange(false);
    },
  };
}

// The saved choices are read through useSyncExternalStore (the server and the first client render see the defaults, then the page's own saved values): subscribe, and tell the subscribers when a choice is saved.
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export function subscribeStore(fn: () => void): () => void {
  listeners.add(fn);
  if (typeof window !== "undefined") window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", fn);
  };
}

const KEY = "sme-ask-autoplay";
const NOTICE_KEY = "sme-ask-voice-notice";

/** The saved "play voice answers automatically" choice: "1", "0", or null when the person has not chosen. */
export function readAutoplay(): boolean | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}
export function saveAutoplay(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // storage is blocked: the box keeps the choice itself until the page is closed
  }
  emit();
}
/** Phones start with spoken answers on (hands are busy, the screen is small); a laptop starts with them off. */
export function defaultAutoplay(): boolean {
  try {
    return window.matchMedia("(max-width: 767px)").matches;
  } catch {
    return false;
  }
}
export function noticeSeen(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}
export function markNoticeSeen(): void {
  try {
    window.localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    // storage is blocked: the line shows again next time, which is the safe way round
  }
  emit();
}
