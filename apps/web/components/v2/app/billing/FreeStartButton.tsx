"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { btnQuiet } from "../ui";
import { makeT, type Words } from "../words";

type Result = { ok: true } | { ok: false; error: string };

/** "Claim your free start" (the Owner, once): the page's server action, then the page reads again. */
export function FreeStartButton({ words, claim }: { words: Words; claim: () => Promise<Result> }) {
  const t = makeT(words);
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const [note, setNote] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2" data-part="free-start">
      <button
        type="button"
        disabled={busy}
        className={btnQuiet}
        onClick={() =>
          start(async () => {
            setNote(null);
            const out = await claim().catch((): Result => ({ ok: false, error: t("bv6.err.generic") }));
            if (out.ok) router.refresh();
            else setNote(out.error);
          })
        }
      >
        {t("bv6.free.claim")}
      </button>
      {note ? (
        <p role="alert" className="text-sm font-semibold text-red-text">
          {note}
        </p>
      ) : null}
    </div>
  );
}
