"use server";

import { headers } from "next/headers";

import { postWaitlist } from "@/lib/api/waitlist";
import { clientIp } from "@/lib/auth/signup-limit";
import { passesTurnstile } from "@/lib/security/turnstile";
import { sharedLeadLimiter } from "@/lib/site/lead-limit";
import { waitlistMode } from "@/lib/waitlist/mode";
import { readWaitlist, type WaitlistResult } from "@/lib/waitlist/types";

/**
 * "Book a demo / join the waitlist" (job DQ). The input is whatever the browser sent, so every field is checked here (lib/waitlist/types.ts); a hidden field only a script fills is a quiet success that stores nothing; a try is counted
 * against the address's hourly limit (the API has its own, 5 an hour per address). `WAITLIST=mock` keeps nothing at all (review and pictures); `1` (or unset in website mode) posts to the API.
 */
export async function joinWaitlist(input: unknown): Promise<WaitlistResult> {
  const mode = waitlistMode();
  if (mode === "off") return { ok: false, error: "down" };
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const read = readWaitlist(raw);
  if (!read.ok) return read;
  if (typeof raw.website === "string" && raw.website !== "") return { ok: true };
  const ip = clientIp(await headers());
  if (!sharedLeadLimiter().allow(ip)) return { ok: false, error: "rate" };
  if (!(await passesTurnstile(raw.turnstileToken, ip))) return { ok: false, error: "check" }; // the check box (when it is on): no good token, no form
  return mode === "mock" ? { ok: true } : postWaitlist(read.value);
}
