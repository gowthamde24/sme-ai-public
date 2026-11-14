import type { Failure } from "@/lib/staff/source";

/** The staff session ended: every client piece that gets `signed_out` goes to the plain page (never a sentence of its own). */
export function leaveIfSignedOut(failure: Failure): boolean {
  if (failure !== "signed_out") return false;
  window.location.assign("/staff/signed-out");
  return true;
}
