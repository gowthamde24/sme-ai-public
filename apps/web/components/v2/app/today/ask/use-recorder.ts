"use client";

import * as React from "react";

import { MAX_SECONDS, MIN_MS, RecordError, startRecording, type RecordProblem, type Recording } from "./recorder";

export type RecorderState = "idle" | "starting" | "recording";
export type RecorderProblem = RecordProblem | "short";

/**
 * The recording of one question, as the Ask box drives it (job BF): `start` asks for the microphone and records, `stop` ends it and hands the audio to `onRecorded`, `cancel` throws it away. It stops by
 * itself at MAX_SECONDS. `left` counts down for the screen. A recording shorter than a moment (an accidental touch) is not sent: `onProblem("short")`. Everything is released on unmount.
 */
export function useRecorder({ onRecorded, onProblem }: { onRecorded: (audio: Blob) => void; onProblem: (problem: RecorderProblem) => void }) {
  const [state, setStateRaw] = React.useState<RecorderState>("idle");
  const [left, setLeft] = React.useState(MAX_SECONDS);
  const stateRef = React.useRef<RecorderState>("idle");
  const rec = React.useRef<Recording | null>(null);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const began = React.useRef(0);
  const generation = React.useRef(0);
  const callbacks = React.useRef({ onRecorded, onProblem });
  React.useEffect(() => {
    callbacks.current = { onRecorded, onProblem }; // the latest, for a recording that ends later
  });

  const setState = React.useCallback((s: RecorderState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);
  const clearTimer = React.useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const finish = React.useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearTimer();
    const ms = Date.now() - began.current;
    setState("idle");
    try {
      const blob = await r.stop();
      if (ms < MIN_MS || blob.size === 0) callbacks.current.onProblem("short");
      else callbacks.current.onRecorded(blob);
    } catch {
      callbacks.current.onProblem("failed");
    }
  }, [clearTimer, setState]);

  const start = React.useCallback(async () => {
    if (stateRef.current !== "idle") return;
    setState("starting");
    const mine = ++generation.current;
    let r: Recording;
    try {
      r = await startRecording();
    } catch (error) {
      if (mine !== generation.current) return;
      setState("idle");
      callbacks.current.onProblem(error instanceof RecordError ? error.problem : "failed");
      return;
    }
    if (mine !== generation.current) {
      r.cancel(); // cancelled while the browser was asking for the microphone
      return;
    }
    rec.current = r;
    began.current = Date.now();
    setLeft(MAX_SECONDS);
    setState("recording");
    timer.current = setInterval(() => {
      const remaining = MAX_SECONDS - (Date.now() - began.current) / 1000;
      if (remaining <= 0) void finish();
      else setLeft(remaining);
    }, 250);
  }, [finish, setState]);

  const stop = React.useCallback(() => {
    if (rec.current) void finish();
  }, [finish]);

  const cancel = React.useCallback(() => {
    generation.current++;
    const r = rec.current;
    rec.current = null;
    clearTimer();
    r?.cancel();
    setState("idle");
  }, [clearTimer, setState]);

  React.useEffect(() => cancel, [cancel]);

  return { state, left, start, stop, cancel };
}
