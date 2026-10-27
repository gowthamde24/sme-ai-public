"use client";

import * as React from "react";

import { isLive, progressCounts, type TaskOut } from "@/lib/tasks/types";

import type { TaskActions } from "./task-actions";

/** How often a running task is asked for its progress (ms): the contract says poll `GET /tasks/{id}`; two to three seconds keeps "3 of 12" moving without hammering the API. */
export const POLL_MS = 2500;
/** After this many polls in a row with no progress, a running task offers "Continue" (the server may have restarted: `POST /run` continues what is waiting). */
export const STALL_POLLS = 6;

/**
 * Watches a task while it is approved or running: a client that asks the progress every POLL_MS and hands each answer to `onTask`. It stops by itself when the task is paused or over, and when the screen is left. A failed read is
 * remembered (`failed`), not shown as a stop: it tries again at the next tick. `stalled` = running for STALL_POLLS polls without anyone finishing.
 */
export function useTaskPolling(task: TaskOut | null, progress: TaskActions["progress"], onTask: (t: TaskOut) => void, every = POLL_MS): { failed: boolean; stalled: boolean } {
  const id = task?.id ?? null;
  const live = task !== null && isLive(task.status);
  const [failed, setFailed] = React.useState(false);
  const [still, setStill] = React.useState(0);
  const last = React.useRef(-1);
  const sink = React.useRef(onTask);
  React.useEffect(() => {
    sink.current = onTask;
  });
  React.useEffect(() => {
    if (!live || id === null) return;
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const got = await progress(id);
        if (stop) return;
        if (got.ok) {
          setFailed(false);
          const n = progressCounts(got.task.progress).finished;
          setStill((s) => (n === last.current ? s + 1 : 0));
          last.current = n;
          sink.current(got.task);
        } else setFailed(true);
      } catch {
        if (!stop) setFailed(true);
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(() => void tick(), every);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [live, id, progress, every]);
  return { failed: live && failed, stalled: live && still >= STALL_POLLS };
}
