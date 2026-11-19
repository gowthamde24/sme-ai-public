/** 83 seconds -> "1:23". Its own file so Today's first chunk can show a call's time without the live conversation's code (use-talk-live.ts re-exports it). */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
