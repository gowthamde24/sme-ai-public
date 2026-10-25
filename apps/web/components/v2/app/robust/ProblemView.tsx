import type { ReactNode } from "react";

import { OrbMark } from "../mark/OrbMark";
import { word, type Labels } from "../labels";
import { mutedText, notFoundBack, notFoundOwl, notFoundTitle } from "../ui";

export type ProblemKind = 403 | 404 | 429 | 500;
export const PROBLEM_KINDS: readonly ProblemKind[] = [403, 404, 429, 500];

const ENGLISH: Record<ProblemKind, { title: string; body: string; titleKey: string; bodyKey: string }> = {
  403: { titleKey: "problem.403.title", bodyKey: "problem.403.body", title: "This is not open to you", body: "Your role does not include this page. Ask the owner if you need it." },
  404: { titleKey: "notfound.title", bodyKey: "notfound.body", title: "Not found", body: "We could not find that page." },
  429: { titleKey: "problem.429.title", bodyKey: "problem.429.body", title: "Too many tries", body: "Please wait a minute, then try again. Nothing you typed is lost." },
  500: { titleKey: "problem.500.title", bodyKey: "problem.500.body", title: "Something went wrong on our side", body: "It is not you. Please try again in a moment." },
};

/**
 * One friendly page for 403, 404, 429 and 500 (job BW): the owl, a title and one sentence in the person's language, and a way out (`action` is the retry button for a 429 and a 500; the way back is always there).
 * Plain server-safe markup (the way back is a plain link: a screen that failed should reload cleanly, and the root error page has no router): not-found.tsx draws it on the server, the error boundaries on the client. It says nothing about WHY a page is refused or missing beyond the closed sentence (a page that is not yours and one that
 * does not exist look the same on purpose).
 */
export function ProblemView({ kind, labels, action, reference, tag: Tag = "main", className, variant, homeHref }: { kind: ProblemKind; labels?: Labels; action?: ReactNode; reference?: string; tag?: "main" | "div"; className?: string; /** "module": a 403 for a part the business type does not have (job CL): its own sentence, and the way back is Today of the workspace. */ variant?: "module"; /** Where "back" goes (Today of the workspace for the module variant); default the list of workspaces. */ homeHref?: string }) {
  const e = variant === "module" ? { titleKey: "problem.module.title", bodyKey: "problem.module.body", title: "This part is not switched on", body: "Your kind of business does not use this part of the app. Go back to Today." } : ENGLISH[kind];
  return (
    <Tag data-problem={kind} className={className ?? "mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center"}>
      <OrbMark px={96} mood={kind === 500 ? "resting" : "idle"} className={notFoundOwl} />
      <h1 className={notFoundTitle}>{word(labels, e.titleKey, e.title)}</h1>
      <p className={mutedText}>{word(labels, e.bodyKey, e.body)}</p>
      {action}
      {/* a plain link on purpose: a failed screen reloads cleanly and the root error page has no router */}
      <a href={homeHref ?? "/app"} className={action ? "inline-flex min-h-11 items-center rounded-lg text-base font-semibold text-brand-text hover:underline" : notFoundBack}>
        {word(labels, "problem.home", word(labels, "notfound.back", "Back to your workspaces"))}
      </a>
      {reference ? <p className="text-sm text-muted">{word(labels, "problem.ref", "Reference for support: {ref}", { ref: reference })}</p> : null}
    </Tag>
  );
}
