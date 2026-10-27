import Link from "next/link";

import type { Failure } from "@/lib/lead-desk/imports/types";

import { alertBox } from "../ui";
import { makeT, type Words } from "../words";

/** One closed sentence for a refusal of the import or source calls (the API's own text is never shown), the way out for a missing second factor, and the reason for a refused file. */
export function FailureNote({ words, failure }: { words: Words; failure: Failure }) {
  const t = makeT(words);
  return (
    <p role="alert" className={alertBox}>
      {t(`li.err.${failure.error}`)}
      {failure.reason ? ` ${t(`li.refused.${failure.reason}`)}` : ""}{" "}
      {failure.error === "mfa" ? (
        <Link href="/app/security" className="font-semibold underline">
          {t("li.err.mfa.link")}
        </Link>
      ) : null}
    </p>
  );
}
