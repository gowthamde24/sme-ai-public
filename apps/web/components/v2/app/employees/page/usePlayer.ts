"use client";

import * as React from "react";

import type { EmployeePreview } from "@/lib/api/employees";
import type { Done, Refusal } from "@/lib/employees/types";

/**
 * One sound at a time for the voice tab. A recorded voice sample plays from this app's own address; a spoken line of the employee (`previewEmployeeAction`: wav, base64) is turned into a `blob:` address, the only other
 * place the page's media rule allows. Nothing plays by itself. `problem` is a closed refusal (`emp.err.*`) or "sample" when the browser could not play it.
 */
export function usePlayer() {
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<Refusal | "sample" | null>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const cleanup = React.useRef<(() => void) | null>(null);
  const turn = React.useRef(0);

  const halt = React.useCallback(() => {
    turn.current += 1;
    audio.current?.pause();
    audio.current = null;
    cleanup.current?.();
    cleanup.current = null;
  }, []);
  const stop = React.useCallback(() => {
    halt();
    setPlaying(null);
    setLoading(null);
  }, [halt]);
  React.useEffect(() => halt, [halt]);

  const start = (key: string, src: string, mark: number, done?: () => void) => {
    const a = new Audio(src);
    audio.current = a;
    cleanup.current = done ?? null;
    a.onended = () => {
      if (turn.current === mark) setPlaying(null);
    };
    a.onerror = () => {
      if (turn.current !== mark) return;
      setPlaying(null);
      setLoading(null);
      setProblem("sample");
    };
    setLoading(null);
    setPlaying(key);
    void Promise.resolve(a.play()).catch(() => {
      if (turn.current !== mark) return;
      setPlaying(null);
      setProblem("sample");
    });
  };

  /** A recorded sample at an address of this app. A second tap on the playing one stops it. */
  const playUrl = (key: string, src: string) => {
    if (playing === key || loading === key) return stop();
    stop();
    setProblem(null);
    start(key, src, turn.current);
  };
  /** The employee's own voice, spoken by the API. */
  const playSpoken = (key: string, get: () => Promise<Done<EmployeePreview>>) => {
    if (playing === key || loading === key) return stop();
    stop();
    setProblem(null);
    setLoading(key);
    const mark = turn.current;
    void get()
      .catch((): Done<EmployeePreview> => ({ ok: false, error: "unavailable" }))
      .then((out) => {
        if (turn.current !== mark) return;
        if (!out.ok) {
          setLoading(null);
          return setProblem(out.error);
        }
        try {
          const bytes = Uint8Array.from(atob(out.data.base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: out.data.mime }));
          start(key, url, mark, () => URL.revokeObjectURL(url));
        } catch {
          setLoading(null);
          setProblem("sample");
        }
      });
  };
  return { playing, loading, problem, playUrl, playSpoken, stop };
}
export type Player = ReturnType<typeof usePlayer>;
