"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import type { FollowupActionState } from "./followup-actions";

type Action = (prev: FollowupActionState, formData: FormData) => Promise<FollowupActionState>;

/**
 * The state of one follow-up form: the action's outcome, whether it is running, and the refetch rule. When the database refuses because what the person is looking at is out of date
 * (a stale draft, a changed history, a contact that was suppressed meanwhile) the action says so (`stale`) and the page is read again, so the person sees the new state instead of a guess.
 * The markup of the forms is separate: a redesign restyles the forms without touching this.
 */
export function useFollowupAction(action: Action) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, undefined);
  useEffect(() => {
    if (state && state.ok === false && state.stale) router.refresh();
  }, [state, router]);
  return { state, formAction, pending };
}
