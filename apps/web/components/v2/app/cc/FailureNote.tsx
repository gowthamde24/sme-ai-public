"use client";

import Link from "next/link";

import { makeT, type Words } from "../words";
import { errorLine, sentenceOf, type Failed } from "./kit";

/**
 * A refusal in the page (job CC): our sentence, in an alert, and, for a missing second step, the way to the Security page. Nothing the person typed is cleared by it. `own` gives a sentence for a closed code of the
 * screen first (a file the API could not read, a name that did not match).
 */
export function FailureNote({ failure, words, own }: { failure: Failed | null; words: Words; own?: (code: string) => string | null }) {
  if (!failure) return null;
  const t = makeT(words);
  return (
    <p role="alert" className={errorLine}>
      {sentenceOf(failure, t, own)}
      {failure.kind === "mfa" ? (
        <>
          {" "}
          <Link href="/app/security" className="font-semibold underline">
            {t("apierr.security_link")}
          </Link>
        </>
      ) : null}
    </p>
  );
}
