"use client";

import { useEffect, useRef, useState } from "react";

import type { Connected } from "@/lib/api/whatsapp";
import { loadFacebookSdk, loginOptions, readSignupMessage, type FbSdk } from "@/lib/whatsapp/embedded-signup";

import { FailureNote } from "../cc/FailureNote";
import { card, h2, help, okLine, primary, type Failed } from "../cc/kit";
import { makeT, type Words } from "../words";
import type { Out } from "./wa-types";
import { waSentence } from "./wa-model";

export type SignupConfig = { appId: string; configId: string; graphVersion: string; /** The API can record a number that stays on the WhatsApp Business app (its `onboarding_types` has "coexistence"). */ coexistence?: boolean };
type State = "idle" | "connecting" | "saving" | "connected" | "cancelled" | "failed";

/**
 * "Connect with Facebook" (Meta Embedded Signup, Customer Zero): the Owner presses one button, Meta's window opens, the shop picks its WhatsApp Business account and number (a number on the WhatsApp Business app can stay on it), and we record it.
 * Meta's SDK is loaded only here, on first press (route-JS budget). Two answers arrive in either order: the short `code` (from `FB.login`) and the account and number (a window message); when both are in, they go to our API once. The states are plain:
 * connecting, connected (the number and the name WhatsApp verified), cancelled, failed (with Meta's reason in words when it gave one). `sdk` is for the tests.
 */
export function ConnectWithFacebook({ words, config, connect, onConnected, sdk = loadFacebookSdk }: { words: Words; config: SignupConfig; connect: (f: { code: string; wabaId: string; phoneNumberId: string; coexistence?: true }) => Promise<Out<Connected>>; onConnected?: (c: Connected) => void; sdk?: (appId: string, version: string) => Promise<FbSdk> }) {
  const t = makeT(words);
  const [state, setState] = useState<State>("idle");
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<Failed | null>(null);
  const [done, setDone] = useState<Connected | null>(null);
  const got = useRef<{ code: string | null; ids: { wabaId: string; phoneNumberId: string; coexistence: boolean } | null; sent: boolean }>({ code: null, ids: null, sent: false });
  const listener = useRef<((e: MessageEvent) => void) | null>(null);

  useEffect(
    () => () => {
      if (listener.current) window.removeEventListener("message", listener.current);
    },
    [],
  );

  async function finishIfReady() {
    const g = got.current;
    if (g.sent || !g.code || !g.ids) return;
    g.sent = true;
    setState("saving");
    const r = await connect({ code: g.code, wabaId: g.ids.wabaId, phoneNumberId: g.ids.phoneNumberId, ...(config.coexistence && g.ids.coexistence ? { coexistence: true as const } : {}) });
    stopListening();
    if (!r.ok) {
      setFailure(r);
      setState("failed");
      return;
    }
    setDone(r.data);
    setState("connected");
    onConnected?.(r.data);
  }
  function stopListening() {
    if (listener.current) window.removeEventListener("message", listener.current);
    listener.current = null;
  }
  function fail(why: string) {
    stopListening();
    setReason(why);
    setFailure(null);
    setState("failed");
  }

  async function start() {
    got.current = { code: null, ids: null, sent: false };
    setReason("");
    setFailure(null);
    setDone(null);
    setState("connecting");
    let fb: FbSdk;
    try {
      fb = await sdk(config.appId, config.graphVersion);
    } catch {
      return fail("");
    }
    stopListening();
    listener.current = (e: MessageEvent) => {
      const m = readSignupMessage(e);
      if (!m) return;
      if (m.kind === "cancel") {
        stopListening();
        setState("cancelled");
      } else if (m.kind === "error") fail(m.reason);
      else {
        got.current.ids = { wabaId: m.wabaId, phoneNumberId: m.phoneNumberId, coexistence: m.coexistence };
        void finishIfReady();
      }
    };
    window.addEventListener("message", listener.current);
    fb.login((r) => {
      const code = r.authResponse?.code;
      if (!code) {
        if (!got.current.ids) {
          stopListening();
          setState("cancelled");
        }
        return;
      }
      got.current.code = code;
      void finishIfReady();
    }, loginOptions(config.configId));
  }

  const busy = state === "connecting" || state === "saving";
  return (
    <section className={card} aria-labelledby="wa-fb-title" data-part="connect-facebook" data-fb-state={state}>
      <h2 id="wa-fb-title" className={h2}>
        {t("wa.fb.title")}
      </h2>
      <p className="text-base">{t("wa.fb.body")}</p>
      <p className={help}>{t("wa.fb.coexistence")}</p>
      {state === "connected" && done ? (
        <p role="status" className={okLine} data-part="fb-connected">
          {t("wa.fb.connected", { phone: done.displayPhone ?? "", name: done.verifiedName ?? "" })}
        </p>
      ) : (
        <div>
          <button type="button" onClick={() => void start()} disabled={busy} className={primary} data-act="connect-facebook">
            {state === "saving" ? t("wa.fb.saving") : state === "connecting" ? t("wa.fb.connecting") : t("wa.fb.button")}
          </button>
        </div>
      )}
      {state === "connecting" ? (
        <p role="status" className={help}>
          {t("wa.fb.waiting")}
        </p>
      ) : null}
      {state === "cancelled" ? (
        <p role="status" className={help} data-part="fb-cancelled">
          {t("wa.fb.cancelled")}
        </p>
      ) : null}
      {state === "failed" ? (
        <div role="alert" className="flex flex-col gap-1" data-part="fb-failed">
          {failure ? <FailureNote failure={failure} words={words} own={(code) => waSentence(code, t)} /> : <p className="m-0 text-sm font-medium text-red-text">{reason ? t("wa.fb.failed.why", { why: reason }) : t("wa.fb.failed")}</p>}
          <p className={help}>{t("wa.fb.tryagain")}</p>
        </div>
      ) : null}
    </section>
  );
}

export default ConnectWithFacebook;
