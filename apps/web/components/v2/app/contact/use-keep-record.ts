import { useSyncExternalStore } from "react";

/**
 * "Keep a record of this" (job AV): ticked unless the person unticked it on this device. Remembered in the browser's own storage, one key, never on the server. Storage that is missing, blocked or throwing
 * (a private window, blocked site data) is not an error: the box is ticked and the choice lives for this visit only. The server never sees where the choice is kept; the form sends it as a plain true or false.
 */
export const KEEP_RECORD_KEY = "sme.contact.keepRecord";

let memory: boolean | null = null; // the choice made in this tab since it opened (used when storage cannot be written or read)
const listeners = new Set<() => void>();

function read(): boolean {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(KEEP_RECORD_KEY) !== "0";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEEP_RECORD_KEY || event.key === null) {
      memory = null; // another tab chose: its choice is the one in storage
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setKeepRecord(value: boolean): void {
  memory = value;
  try {
    window.localStorage.setItem(KEEP_RECORD_KEY, value ? "1" : "0");
  } catch {
    // storage is not available: the choice stays in memory for this visit
  }
  listeners.forEach((l) => l());
}

/** Forgets the choice made in this tab (for a test). */
export function resetKeepRecordMemory(): void {
  memory = null;
}

export function useKeepRecord(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, read, () => true);
  return [value, setKeepRecord];
}
