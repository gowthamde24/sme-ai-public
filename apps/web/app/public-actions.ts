"use server";

import { headers } from "next/headers";

import { clientIp } from "@/lib/auth/signup-limit";
import { readTalk, storeTalk, type TalkResult } from "@/lib/public/demo";
import { passesTurnstile } from "@/lib/security/turnstile";
import { sharedLeadLimiter } from "@/lib/site/lead-limit";

/**
 * "Talk to us / Book a demo" (launch public pages). The input is whatever the browser sent, so every field is checked (lib/public/demo.ts); a hidden field only a script fills is a quiet success that stores nothing; a try is counted
 * against the address's hourly limit, like the waitlist and the contact form. For now nothing is stored (storeTalk).
 */
export async function requestTalk(input: unknown): Promise<TalkResult> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const read = readTalk(raw);
  if (!read.ok) return read;
  if (typeof raw.website === "string" && raw.website !== "") return { ok: true };
  const ip = clientIp(await headers());
  if (!sharedLeadLimiter().allow(ip)) return { ok: false, error: "rate" };
  if (!(await passesTurnstile(raw.turnstileToken, ip))) return { ok: false, error: "check" };
  return storeTalk(read.value);
}
