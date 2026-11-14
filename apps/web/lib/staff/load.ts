import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireUser } from "@/lib/auth/session";
import { staffConsole } from "@/lib/screens/flag";

import { type Result, type Source, makeSource, mockRoleOf } from "./source";
import type { Overview, StaffMe } from "./types";

/**
 * What every staff page needs to draw its frame: who the staff member is and the Overview answer (role, environment label, badges). Read once per request (the layout and the page share it). With the flag off the whole area is a plain 404. A person who
 * is not signed in is sent to sign in by `requireUser`; every other refusal comes back as a `Failure` for the layout to draw in plain words. SERVER ONLY.
 */
export interface StaffState {
  me: StaffMe;
  overview: Overview;
  /** The query to keep on links so the mock's `?role=` survives a click ("" for the real API). */
  keep: string;
}

/** The signed-in person's token and the data source for this request (404 when the console is off). */
export async function staffSource(): Promise<{ source: Source; mock: boolean; role: ReturnType<typeof mockRoleOf> }> {
  const mode = staffConsole();
  if (mode === "off") notFound();
  const user = await requireUser();
  const role = mode === "mock" ? mockRoleOf((await headers()).get("x-sme-path")) : "owner";
  return { source: makeSource(mode, user.accessToken, role), mock: mode === "mock", role };
}

export const loadStaff = cache(async (): Promise<Result<StaffState>> => {
  const { source, mock, role } = await staffSource();
  // one after the other (the first sign-in creates the staff session row: two calls at once raced for it, and the loser answered 409), and a failed read is tried once more
  const once = async <T,>(read: () => Promise<Result<T>>): Promise<Result<T>> => {
    const first = await read();
    return !first.ok && first.failure === "unavailable" ? read() : first;
  };
  const me = await once(() => source.me());
  if (!me.ok) return me;
  const overview = await once(() => source.overview());
  if (!overview.ok) return overview;
  return { ok: true, data: { me: me.data, overview: overview.data, keep: mock && role !== "owner" ? `?role=${role}` : "" } };
});
