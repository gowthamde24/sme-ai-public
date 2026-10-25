"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { CONSENT_SECONDS, SAMPLE_MAX_BYTES, SAMPLE_SECONDS, validConsentName, type OwnVoice as Voice } from "@/lib/own-voice/types";

import { postJson } from "../cc/post";
import { canRecord } from "../today/ask/recorder";
import { useRecorder, type RecorderProblem } from "../today/ask/use-recorder";
import { alertBox, btnMain, btnQuiet, fieldInput, fieldLabel, mutedText, noteBox, okBox, surface, warnBox } from "../ui";
import { makeT, type Words } from "../words";

export type OwnVoiceActions = {
  sentence: (name: string) => Promise<string | null>;
  remove: () => Promise<{ ok: true } | { ok: false; code: string; mfa?: boolean }>;
};
type Take = { blob: Blob; seconds: number; url: string };
const ERR: Record<string, string> = {
  voice_exists: "ov.err.exists",
  consent_sentence_mismatch: "ov.err.mismatch",
  recording_not_audio: "ov.err.audio",
  recording_length_mismatch: "ov.err.audio",
  recording_implausible_length: "ov.err.audio",
  recording_not_base64: "ov.err.audio",
  recording_missing: "ov.err.audio",
  recording_too_large: "ov.err.audio",
  voice_provider_refused: "ov.err.provider",
  voice_provider_unreachable: "ov.err.delete",
  recordings_not_removed: "ov.err.delete",
  workspace_read_only: "ov.err.readonly",
};
const date = (iso: string | null): string => (iso ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "");
const toBase64 = (b: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(b);
  });
const lengthOf = (blob: Blob): Promise<number | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => (URL.revokeObjectURL(url), resolve(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null));
    a.onerror = () => (URL.revokeObjectURL(url), resolve(null));
    a.src = url;
  });

/** One recording step: a button that records (with the seconds left), the take with a player and its length, and "record again". */
function Step({ label, take, onTake, seconds, t, mic, upload, tooShort, failedWith }: { label: string; take: Take | null; onTake: (t: Take | null) => void; seconds: { min: number; max: number }; t: ReturnType<typeof makeT>; mic: boolean; upload: boolean; tooShort: string; failedWith: (m: string | null) => void }) {
  const began = React.useRef(0);
  const rec = useRecorder({
    onRecorded: (blob) => {
      const length = (Date.now() - began.current) / 1000;
      onTake({ blob, seconds: Math.round(length * 10) / 10, url: URL.createObjectURL(blob) });
    },
    onProblem: (p: RecorderProblem) => failedWith(p === "short" ? t("ov.err.short") : t("ov.err.mic")),
  });
  React.useEffect(() => {
    if (rec.state === "recording") began.current = Date.now();
  }, [rec.state]);
  const url = take?.url;
  React.useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  const fits = take !== null && take.seconds >= seconds.min && take.seconds <= seconds.max;
  return (
    <div className="flex flex-col gap-2">
      {take === null ? (
        <div className="flex flex-wrap items-center gap-3">
          {rec.state === "recording" ? (
            <>
              <button type="button" className={btnMain} onClick={rec.stop}>
                {t("ov.rec.stop")}
              </button>
              <span role="status" className="text-base">{t("ov.rec.left", { n: Math.ceil(rec.left) })}</span>
            </>
          ) : (
            <button type="button" className={btnMain} disabled={!mic || rec.state === "starting"} onClick={() => (failedWith(null), void rec.start())}>
              {label}
            </button>
          )}
          {upload && rec.state !== "recording" ? (
            <label className="inline-flex min-h-12 cursor-pointer items-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold hover:bg-surface-2">
              {t("ov.upload")}
              <input
                type="file"
                accept="audio/*,video/webm,video/mp4"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const length = f.size <= SAMPLE_MAX_BYTES ? await lengthOf(f) : null;
                  if (length === null) return failedWith(t("ov.err.upload"));
                  failedWith(null);
                  onTake({ blob: f, seconds: Math.round(length * 10) / 10, url: URL.createObjectURL(f) });
                }}
              />
            </label>
          ) : null}
        </div>
      ) : (
        <>
          <audio controls src={take.url} className="w-full max-w-md" aria-label={t("ov.listen")} />
          <p className={fits ? "text-base" : "text-base font-medium text-red-text"} role={fits ? undefined : "alert"}>
            {fits ? t("ov.rec.length", { n: Math.round(take.seconds) }) : tooShort}
          </p>
          <div>
            <button type="button" className={btnQuiet} onClick={() => onTake(null)}>
              {t("ov.rec.again")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "Use my own voice" in Settings > AI assistant (job DP; C1's contract-own-voice.md). The Owner enters the name that consents, reads ONE fixed sentence aloud (it has the name and the business in it) and records a 15 to 60
 * second sample (or chooses a sound file for it); both are listened to here, then sent once, with the second factor, and a voice is made (a fake one until the provider is real: the card says so). Afterwards the card shows who
 * consented and when, and "Delete my voice" (asks once; removes the voice and both recordings). The assistant still says it is the AI assistant. An Admin sees the status only. The recordings are never shown again: only played back
 * here, before they are sent.
 */
export function OwnVoice({ words, voice, canEdit, endpoint, actions }: { words: Words; voice: Voice; canEdit: boolean; endpoint: string; actions: OwnVoiceActions }) {
  const t = makeT(words);
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [sentence, setSentence] = React.useState<string | null>(null);
  const [consent, setConsent] = React.useState<Take | null>(null);
  const [sample, setSample] = React.useState<Take | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const [id] = React.useState(() => crypto.randomUUID()); // one per attempt: a retry is the same request
  const mic = React.useSyncExternalStore(() => () => {}, () => canRecord(), () => false);
  const nameOk = validConsentName(name);
  const ready = nameOk && sentence !== null && consent !== null && sample !== null && consent.seconds >= CONSENT_SECONDS.min && consent.seconds <= CONSENT_SECONDS.max && sample.seconds >= SAMPLE_SECONDS.min && sample.seconds <= SAMPLE_SECONDS.max;
  const said = (key: string, mfa = false) => setProblem({ text: t(key as "ov.err.generic"), ...(mfa ? { mfa: true } : {}) });

  async function showSentence() {
    setProblem(null);
    setBusy(true);
    const s = await actions.sentence(name.trim()).catch(() => null);
    setBusy(false);
    if (s) {
      setSentence(s);
      setConsent(null);
    } else said("ov.err.generic");
  }
  async function create() {
    if (!ready || busy || !sentence || !consent || !sample) return;
    setProblem(null);
    setBusy(true);
    try {
      const body = { id, name: name.trim(), consent_sentence: sentence, sample_base64: await toBase64(sample.blob), sample_type: sample.blob.type.split(";")[0] || "audio/webm", sample_seconds: sample.seconds, consent_base64: await toBase64(consent.blob), consent_type: consent.blob.type.split(";")[0] || "audio/webm", consent_seconds: consent.seconds };
      const out = await postJson<unknown>(endpoint, body);
      if (out.ok) {
        setConsent(null);
        setSample(null);
        setSentence(null);
        router.refresh();
      } else if (out.mfa) said("today.err.mfa", true);
      else said(out.code && ERR[out.code] ? ERR[out.code] : "ov.err.generic");
    } catch {
      said("ov.err.generic");
    }
    setBusy(false);
  }
  async function remove() {
    if (busy) return;
    setProblem(null);
    setBusy(true);
    const out = await actions.remove().catch(() => ({ ok: false as const, code: "unavailable" }));
    setBusy(false);
    setAsking(false);
    if (out.ok) {
      setGone(true);
      router.refresh();
    } else if ("mfa" in out && out.mfa) said("today.err.mfa", true);
    else said(out.code && ERR[out.code] ? ERR[out.code] : "ov.err.generic");
  }

  const error = problem ? (
    <p role="alert" className={alertBox}>
      {problem.text}{" "}
      {problem.mfa ? (
        <Link href="/app/security" className="font-semibold underline">
          {t("today.err.mfa.link")}
        </Link>
      ) : null}
    </p>
  ) : null;

  return (
    <section className={`${surface} flex flex-col gap-4`} aria-labelledby="ov-h" data-settings="own-voice" data-voice-status={voice.status}>
      <div>
        <h2 id="ov-h" className="font-display text-xl font-semibold">
          {t("ov.title")}
        </h2>
        <p className={mutedText}>{t("ov.intro")}</p>
        {voice.fake ? (
          <p role="note" className={`${warnBox} !mt-3`}>
            {t("ov.fake")}
          </p>
        ) : null}
      </div>
      {gone && voice.status !== "ready" ? (
        <p role="status" className={okBox}>
          {t("ov.deleted")}
        </p>
      ) : null}
      {voice.status === "ready" ? (
        <div className="flex flex-col gap-3" data-part="own-voice-ready">
          <p className="font-semibold">{t("ov.ready.title")}</p>
          <p>{t("ov.ready.by", { name: voice.consentingName ?? "", date: date(voice.consentedAt) })}</p>
          <p className={noteBox + " !mt-0"}>{t("ov.ready.use")}</p>
          <p className={mutedText + " !mt-0"}>{t("ov.rule")}</p>
          {canEdit ? (
            asking ? (
              <div role="alertdialog" aria-label={t("ov.delete.ask")} className="flex flex-col gap-3 rounded-lg border border-edge bg-surface-2 p-3">
                <p className="font-medium">{t("ov.delete.ask")}</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className={btnMain} disabled={busy} onClick={() => void remove()}>
                    {t("ov.delete.yes")}
                  </button>
                  <button type="button" className={btnQuiet} disabled={busy} onClick={() => setAsking(false)}>
                    {t("ov.delete.no")}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <button type="button" className={btnQuiet} onClick={() => setAsking(true)}>
                  {t("ov.delete")}
                </button>
              </div>
            )
          ) : (
            <p className={mutedText}>{t("ov.owner")}</p>
          )}
          {error}
        </div>
      ) : !canEdit ? (
        <p className={mutedText}>{t("ov.owner")}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {voice.status === "pending" ? <p role="status">{t("ov.pending")}</p> : null}
          {voice.status === "failed" ? <p role="note" className={warnBox + " !mt-0"}>{t("ov.failed")}</p> : null}
          <div>
            <label htmlFor="ov-name" className={fieldLabel}>
              {t("ov.name")}
            </label>
            <input id="ov-name" value={name} maxLength={80} autoComplete="name" onChange={(e) => (setName(e.target.value), setSentence(null), setConsent(null))} className={fieldInput} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-semibold">{t("ov.s1")}</p>
            {sentence === null ? (
              <div>
                <button type="button" className={btnQuiet} disabled={!nameOk || busy} onClick={() => void showSentence()}>
                  {t("ov.sentence.get")}
                </button>
              </div>
            ) : (
              <>
                <blockquote className="rounded-lg border-l-4 border-brand-edge bg-surface-2 p-3 text-lg font-medium [overflow-wrap:anywhere]" data-part="consent-sentence">
                  {sentence}
                </blockquote>
                <Step label={t("ov.rec.consent")} take={consent} onTake={setConsent} seconds={CONSENT_SECONDS} t={t} mic={mic} upload={false} tooShort={t("ov.err.len.consent")} failedWith={(m) => setProblem(m ? { text: m } : null)} />
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-semibold">{t("ov.s2")}</p>
            <Step label={t("ov.rec.sample")} take={sample} onTake={setSample} seconds={SAMPLE_SECONDS} t={t} mic={mic} upload tooShort={t("ov.err.len.sample")} failedWith={(m) => setProblem(m ? { text: m } : null)} />
          </div>
          {error}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btnMain} disabled={!ready || busy} onClick={() => void create()}>
              {busy ? t("ov.creating") : t("ov.create")}
            </button>
          </div>
          <p className={mutedText + " !mt-0"}>{t("ov.rule")}</p>
        </div>
      )}
    </section>
  );
}
