"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import type { DevKey, KeyScope, Usage } from "@/lib/api/developer";
import { KEY_SCOPES } from "@/lib/api/developer";

import { sentenceOf, type Failed, type Reply } from "../cc/kit";
import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { card, sectionTitle } from "../v6/ui";
import { makeT, type Words } from "../words";

export type KeyResult = { key: DevKey; secret: string | null };
export type DeveloperActions = {
  create: (input: { name: string; scopes: string[]; ipAllow: string[] }) => Promise<Reply<KeyResult>>;
  rotate: (keyId: string) => Promise<Reply<KeyResult>>;
  revoke: (keyId: string) => Promise<Reply<KeyResult>>;
};
type Shown = { name: string; secret: string };

/**
 * Settings > Developer API keys, TEST mode only (design system v6): the keys with their prefix and last four (never a secret), what each may do, when it was last used, Rotate and Revoke (each asks once more), the test usage, and "Create a test key". A new or rotated key's SECRET is held in this
 * component's state ONLY, in a copy box with a warning, until "I have saved it" (or the page is left): it is not put in an address, a cookie, storage or the list. `keys` null = the keys could not be read.
 */
export function DeveloperKeysCard({ words, lang, keys, usage, mock, actions }: { words: Words; lang: string; keys: readonly DevKey[] | null; usage: Usage | null; mock: boolean; actions: DeveloperActions }) {
  const t = makeT(words);
  const router = useRouter();
  const [form, setForm] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<readonly KeyScope[]>(["leads:write"]);
  const [ips, setIps] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState<{ id: string; what: "rotate" | "revoke" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const own = (code: string): string | null => (["too_many_keys", "invalid_ip", "live_not_available", "validation_error"].includes(code) ? t(`sv6.dk.err.${code}`) : null);
  const say = (f: Failed) => sentenceOf(f, t, own);
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const run = async (work: () => Promise<Reply<KeyResult>>, done: (r: KeyResult) => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await work();
      if (r.ok) {
        done(r.data);
        router.refresh();
      } else setError(say(r));
    } catch {
      setError(t("apierr.generic"));
    } finally {
      setBusy(false);
    }
  };
  const reveal = (r: KeyResult) => {
    if (r.secret) setShown({ name: r.key.name, secret: r.secret });
    setCopied(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown?.secret ?? "");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  // the API lists revoked keys too: the active ones first, the revoked ones after, under their own heading and greyed
  const list = [...(keys ?? [])].sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null));
  const firstRevoked = list.findIndex((k) => k.revokedAt !== null);
  return (
    <section aria-labelledby="sv6-developer" data-part="settings-developer" className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="sv6-developer" className={sectionTitle}>
          {t("sv6.dev.title")}
        </h2>
        <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm font-semibold text-muted">{t("sv6.dev.test")}</span>
      </div>
      <p className="mt-2 text-base text-muted">{t("sv6.dk.text")}</p>
      {mock ? (
        <p role="note" className="mt-1 text-sm text-muted">
          {t("sv6.dk.mock")}
        </p>
      ) : null}

      {shown ? (
        <div role="alert" data-part="key-secret" className="mt-3 rounded-xl border border-brand-edge bg-brand-bg p-3">
          <p className="font-semibold">{t("sv6.dk.once.title")}</p>
          <p className="text-sm text-muted">{shown.name}</p>
          <p className="mt-2 break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm [overflow-wrap:anywhere]" data-part="secret-value">
            {shown.secret}
          </p>
          <p className="mt-2 text-sm font-semibold text-brand-text">{t("sv6.dk.once.warn")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className={btnQuiet}>
              {copied ? t("sv6.dk.copied") : t("sv6.dk.copy")}
            </button>
            <button type="button" onClick={() => { setShown(null); setCopied(false); }} className={btnMain}>
              {t("sv6.dk.saved")}
            </button>
          </div>
        </div>
      ) : null}

      {keys === null ? (
        <p className="mt-3 text-base text-muted">{t("sv6.na")}</p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-base font-semibold text-muted" data-part="dev-none">
          {t("sv6.dev.none")}
        </p>
      ) : (
        <>
          <h3 className="mt-3 text-sm font-semibold text-muted">{t("sv6.dk.list")}</h3>
          <ul className="divide-y divide-line">
            {list.map((k, i) => (
              <Fragment key={k.id}>
              {i === firstRevoked ? (
                <li data-part="revoked-heading" className="pt-3 text-sm font-semibold text-muted">
                  {t("sv6.dk.revoked_list")}
                </li>
              ) : null}
              <li data-key={k.id} data-revoked={k.revokedAt ? "true" : undefined} className={`py-2.5 ${k.revokedAt ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-base font-semibold" data-name="">
                    {k.name}
                  </p>
                  {k.revokedAt ? <span className="text-sm font-semibold text-muted">{t("sv6.dk.revoked")}</span> : null}
                </div>
                <p className="font-mono text-sm text-muted [overflow-wrap:anywhere]">
                  {k.prefix}…{k.last4}
                </p>
                <p className="text-sm text-muted">{k.scopes.map((s) => t(`sv6.dk.scope.${s.replace(":", "_")}`)).join(", ")}</p>
                <p className="text-sm text-muted">{k.lastUsedAt ? t("sv6.dk.used", { date: date(k.lastUsedAt) }) : t("sv6.dk.never")}</p>
                {!k.revokedAt ? (
                  asking?.id === k.id ? (
                    <div className="mt-2 rounded-lg bg-surface-2 p-3">
                      <p className="text-sm">{t(asking.what === "rotate" ? "sv6.dk.rotate.sure" : "sv6.dk.revoke.sure")}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const what = asking.what;
                            setAsking(null);
                            void run(() => (what === "rotate" ? actions.rotate(k.id) : actions.revoke(k.id)), what === "rotate" ? reveal : () => undefined);
                          }}
                          className={btnMain}
                        >
                          {t(asking.what === "rotate" ? "sv6.dk.rotate.yes" : "sv6.dk.revoke.yes")}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setAsking(null)} className={btnQuiet}>
                          {t("today.act.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => setAsking({ id: k.id, what: "rotate" })} className={btnQuiet} aria-label={`${t("sv6.dk.rotate")}: ${k.name}`}>
                        {t("sv6.dk.rotate")}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setAsking({ id: k.id, what: "revoke" })} className={btnQuiet} aria-label={`${t("sv6.dk.revoke")}: ${k.name}`}>
                        {t("sv6.dk.revoke")}
                      </button>
                    </div>
                  )
                ) : null}
              </li>
              </Fragment>
            ))}
          </ul>
        </>
      )}
      {usage ? (
        <p className="mt-2 text-sm text-muted" data-part="dev-usage">
          {t("sv6.dk.usage", { today: usage.today.requests, month: usage.month.requests })}
        </p>
      ) : null}

      {form ? (
        <form
          className="mt-3 flex flex-col gap-3"
          data-part="key-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => actions.create({ name, scopes: [...scopes], ipAllow: ips.split("\n") }),
              (r) => {
                reveal(r);
                setForm(false);
                setName("");
                setIps("");
                setScopes(["leads:write"]);
              },
            );
          }}
        >
          <div>
            <label htmlFor="sv6-key-name" className={fieldLabel}>
              {t("sv6.dk.name")}
            </label>
            <input id="sv6-key-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className={fieldInput} />
          </div>
          <fieldset>
            <legend className={fieldLabel}>{t("sv6.dk.scopes")}</legend>
            <div className="flex flex-col gap-1">
              {KEY_SCOPES.map((s) => (
                <label key={s} className="flex min-h-11 items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-brand-text"
                    checked={scopes.includes(s)}
                    onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                    disabled={busy}
                  />
                  {t(`sv6.dk.scope.${s.replace(":", "_")}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="sv6-key-ip" className={fieldLabel}>
              {t("sv6.dk.ip")}
            </label>
            <textarea id="sv6-key-ip" rows={2} value={ips} onChange={(e) => setIps(e.target.value)} disabled={busy} className={`${fieldInput} py-2 font-mono`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || name.trim() === "" || scopes.length === 0} className={btnMain}>
              {t("sv6.dk.create")}
            </button>
            <button type="button" disabled={busy} onClick={() => { setForm(false); setError(null); }} className={btnQuiet}>
              {t("today.act.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => { setForm(true); setError(null); }} disabled={busy} className={`${btnQuiet} mt-3`} data-part="key-new">
          {t("sv6.dk.make")}
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
