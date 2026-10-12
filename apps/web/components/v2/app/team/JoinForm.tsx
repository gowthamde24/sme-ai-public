"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { Joined } from "@/lib/api/team";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, help, label as labelClass, primary, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";
import { teamSentence } from "./team-model";

/**
 * Join a business with a code (job CC, screen 4). A link a person was sent opens this page with the code after a "#" (which no server is ever sent): the code is copied into the box and taken out of the address bar at once, so it
 * is not in the history or a shared screen. The code is sent as typed. A refusal says what to do and keeps the code in the box.
 */
export function JoinForm({ words, accept }: { words: Words; accept: (code: string) => Promise<{ ok: true; data: Joined } | Failed> }) {
  const t = makeT(words);
  const id = useId();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const fromLink = useRef<string | null>(null); // the code the link carried; kept because a development build runs the effect twice and the first run takes it out of the address

  useEffect(() => {
    if (fromLink.current === null) {
      const m = /(?:^#|&)code=([^&]{1,100})/.exec(window.location.hash);
      if (m) {
        let found = m[1];
        try {
          found = decodeURIComponent(m[1]);
        } catch {
          // the code as it stands
        }
        fromLink.current = found;
        // the address bar is cleaned at once
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    const found = fromLink.current;
    if (found === null) return;
    // the box is filled on the next turn (state is not set inside the effect itself)
    const timer = setTimeout(() => setCode(found), 0);
    return () => clearTimeout(timer);
  }, []);

  async function join() {
    setBusy(true);
    setFailure(null);
    const r = await accept(code);
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setJoined(r.data);
    setCode("");
    router.replace(`/app/tenants/${r.data.tenant_id}`);
  }

  return (
    <section className={card} aria-labelledby={`${id}-h`} data-join="">
      <h1 id={`${id}-h`} className={h2}>
        {t("team.join.title")}
      </h1>
      <p className="text-base text-muted">{t("team.join.intro")}</p>
      {joined ? (
        <p role="status" className="rounded-lg border border-green-text bg-green-bg px-3 py-2 text-base font-medium text-green-text">
          {t("team.join.done", { name: joined.tenant_name })}{" "}
          <Link href={`/app/tenants/${joined.tenant_id}`} className="font-semibold underline">
            {t("team.join.open")}
          </Link>
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <div>
            <label htmlFor={`${id}-code`} className={labelClass}>
              {t("team.join.code")}
            </label>
            <input id={`${id}-code`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={100} autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${field} font-mono`} />
            <p className={help}>{t("team.join.help")}</p>
          </div>
          <FailureNote failure={failure} words={words} own={(c) => teamSentence(c, t)} />
          <div>
            <button type="submit" disabled={busy || code.trim() === ""} className={primary}>
              {busy ? t("dta.btn.working") : t("team.join.button")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
