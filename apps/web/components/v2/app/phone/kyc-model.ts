import type { KycState } from "@/lib/phone-kyc/types";

import type { Status } from "../ds/StatusPill";

/** What the registration card says for each state. "unavailable" is not an API state: it is the card when the API could not be read or says registration is not switched on (503 `kyc_unavailable`). */
export type Shown = KycState | "unavailable";

/** The kit's pill for each state (the word is always there too): grey = nothing yet, blue = being checked, green = registered, red = not accepted, orange = needs a new filing. */
export const PILL: Record<Shown, Status> = {
  not_started: "no_answer",
  preparing: "transferred",
  submitted: "transferred",
  accepted: "completed",
  rejected: "rejected",
  failed: "rejected",
  suspended: "spam",
  expired: "spam",
  unavailable: "no_answer",
};
/** The words of a state: preparing and submitted are both "being checked". */
export const WORD: Record<Shown, string> = {
  not_started: "not_started",
  preparing: "checking",
  submitted: "checking",
  accepted: "accepted",
  rejected: "rejected",
  failed: "failed",
  suspended: "suspended",
  expired: "expired",
  unavailable: "unavailable",
};

/** A fresh id for ONE attempt (the API files the same id once, so pressing the button again after a lost answer does not file twice). `crypto.randomUUID` needs a secure page; the fallback is for a plain-http test box. */
export function newAttemptId(): string {
  const c = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The file as base64 (what the API takes). The ONLY copy: it is made when the button is pressed, goes into the one request and is not kept in the page. */
export function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const out = typeof reader.result === "string" ? reader.result : "";
      const at = out.indexOf(",");
      if (at < 0 || at === out.length - 1) reject(new Error("read"));
      else resolve(out.slice(at + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** A file name the API takes (1 to 99 characters): a longer one keeps its ending, so the kind of file still shows. */
export const apiFileName = (name: string): string => {
  const n = name.replace(/[\\/]/g, "_").trim() || "document";
  return n.length <= 99 ? n : n.slice(-99);
};
