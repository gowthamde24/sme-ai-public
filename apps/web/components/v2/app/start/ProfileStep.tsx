"use client";

import Link from "next/link";
import { useActionState } from "react";

import { errorLine, field, help, label, okLine, primary } from "../visits/styles";

type State = { ok: true } | { ok: false; error: "invalid" | "role" | "failed" | "session" } | undefined;
export type ProfileWords = Readonly<Record<string, string>>;

/**
 * The first checklist question, asked in context (job CL, progressive profiling): the business name and the city, two answers on one small form. `action` is the server action bound to the workspace; the words come from
 * the page. A refusal shows its closed sentence; success says so and offers the way back to Today. Nothing else is asked here.
 */
export function ProfileStep({ action, words, name, town, backHref }: { action: (prev: State, formData: FormData) => Promise<State>; words: ProfileWords; name: string; town: string; backHref: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4" aria-label={words["start.profile.title"]}>
      <div>
        <label htmlFor="start-name" className={label}>
          {words["start.profile.name"]}
        </label>
        <input id="start-name" name="name" required maxLength={120} defaultValue={name} autoComplete="organization" disabled={pending} className={field} />
      </div>
      <div>
        <label htmlFor="start-town" className={label}>
          {words["start.profile.town"]}
        </label>
        <input id="start-town" name="town" required minLength={2} maxLength={80} defaultValue={town} autoComplete="address-level2" disabled={pending} className={field} />
        <p className={help}>{words["start.profile.town.help"]}</p>
      </div>
      {state && !state.ok ? (
        <p role="alert" className={errorLine}>
          {words[`start.profile.err.${state.error}`] ?? words["start.profile.err.failed"]}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className={okLine}>
          {words["start.profile.saved"]}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {words["start.profile.save"]}
        </button>
        {state?.ok ? (
          <Link href={backHref} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">
            {words["start.back"]}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
