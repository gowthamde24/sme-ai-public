"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FILE_TYPES, MAX_FILE_BYTES, MAX_PASTE_CHARS, needsSecondFactor, type Fact, type FactKind, type KDone, type KnowledgeRefusal, type KnowledgeSource } from "@/lib/lead-desk/knowledge";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, fieldTextarea, formStack, mutedText, okBox, pillAmber, pillBrand, pillGreen, pillNeutral, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Step 1 of the Lead Desk setup, "What you sell" (night 4, part A2): the owner gives the assistant something to read (pastes a website or Instagram text, or uploads a brochure, a price list or an FAQ), the AI DRAFTS facts, and the owner
 * decides each one: approve, edit or reject. The assistant may state only approved facts, and a price only as an approved fact of the kind "price" (the Owner, with the second factor). Nothing is stated before it is approved.
 */
export type KnowledgeActions = {
  addPaste: (input: { sourceId: string; title: string; text: string }) => Promise<KDone<KnowledgeSource>>;
  addFile: (input: { sourceId: string; title: string; filename: string; contentType: string; contentBase64: string }) => Promise<KDone<KnowledgeSource>>;
  draft: (sourceId: string) => Promise<KDone<Fact[]>>;
  addFact: (input: { factId: string; kind: FactKind; text: string }) => Promise<KDone<Fact>>;
  edit: (factId: string, input: { text: string; kind?: FactKind }) => Promise<KDone<Fact>>;
  decide: (factId: string, decision: "approve" | "reject") => Promise<KDone<Fact>>;
  discard: (sourceId: string) => Promise<KDone<KnowledgeSource>>;
};
const down: KDone<never> = { ok: false, error: "down" };
const readFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });

export function KnowledgeStep({ words, sources: initialSources, facts: initialFacts, actions, canPrice, securityHref, nextHref }: { words: Words; sources: readonly KnowledgeSource[]; facts: readonly Fact[]; actions: KnowledgeActions; /** The Owner (the API still asks the second factor). */ canPrice: boolean; securityHref: string; nextHref: string }) {
  const t = makeT(words);
  const router = useRouter();
  const [sources, setSources] = React.useState(initialSources);
  const [facts, setFacts] = React.useState(initialFacts);
  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ text: string; mfa: boolean } | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; text: string } | null>(null);
  const [manual, setManual] = React.useState("");
  // the page reads again after a change: what it hands over replaces what was here (derived during render, not in an effect)
  const [seen, setSeen] = React.useState({ initialSources, initialFacts });
  if (seen.initialSources !== initialSources || seen.initialFacts !== initialFacts) {
    setSeen({ initialSources, initialFacts });
    setSources(initialSources);
    setFacts(initialFacts);
  }

  const say = (e: KnowledgeRefusal) => setError({ text: t(`ld.k.err.${e}` as "ld.k.err.down"), mfa: e === "mfa" });
  const run = async <T,>(key: string, job: () => Promise<KDone<T>>, done: (v: T) => void) => {
    setBusy(key);
    setError(null);
    const out = await job().catch((): KDone<T> => down as KDone<T>);
    setBusy(null);
    if (out.ok) {
      done(out.value);
      router.refresh();
    } else say(out.error);
  };
  const upsert = (f: Fact) => setFacts((cur) => (cur.some((x) => x.id === f.id) ? cur.map((x) => (x.id === f.id ? f : x)) : [...cur, f]));

  const addPaste = (ev: React.FormEvent) => {
    ev.preventDefault();
    void run("paste", () => actions.addPaste({ sourceId: crypto.randomUUID(), title: title.trim() || t("ld.k.paste.title.default"), text }), (s) => {
      setSources((cur) => [...cur, s]);
      setText("");
      setTitle("");
    });
  };
  const addFile = async (file: File | undefined) => {
    if (!file) return;
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!(ext in FILE_TYPES)) return say("unsupported");
    if (file.size > MAX_FILE_BYTES) return say("too_large");
    const content = await readFile(file).catch(() => null);
    if (!content) return say("unreadable");
    void run("file", () => actions.addFile({ sourceId: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, ""), filename: file.name, contentType: FILE_TYPES[ext], contentBase64: content }), (s) => setSources((cur) => [...cur, s]));
  };
  const draft = (s: KnowledgeSource) => void run(`draft-${s.id}`, () => actions.draft(s.id), (made) => made.forEach(upsert));
  const decide = (f: Fact, d: "approve" | "reject") => void run(`fact-${f.id}`, () => actions.decide(f.id, d), upsert);
  const saveEdit = () => {
    if (!editing) return;
    void run(`fact-${editing.id}`, () => actions.edit(editing.id, { text: editing.text }), (f) => {
      upsert(f);
      setEditing(null);
    });
  };
  const addManual = (ev: React.FormEvent) => {
    ev.preventDefault();
    void run("manual", () => actions.addFact({ factId: crypto.randomUUID(), kind: "other", text: manual }), (f) => {
      upsert(f);
      setManual("");
    });
  };

  const live = sources.filter((s) => s.status !== "discarded");
  const approved = facts.filter((f) => f.status === "approved").length;
  const drafts = facts.filter((f) => f.status === "draft");
  const pill = (s: Fact["status"]) => (s === "approved" ? pillGreen : s === "rejected" ? pillNeutral : pillAmber);

  return (
    <div data-part="knowledge" className="flex flex-col gap-5">
      <p className="text-base">{t("ld.k.intro")}</p>
      <section className={`${surface} ${formStack}`} aria-labelledby="k-add-h">
        <h3 id="k-add-h" className="font-display text-lg font-bold">
          {t("ld.k.add")}
        </h3>
        <form onSubmit={addPaste} className={formStack}>
          <div>
            <label htmlFor="k-title" className={fieldLabel}>
              {t("ld.k.paste.title")}
            </label>
            <input id="k-title" className={fieldInput} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="k-text" className={fieldLabel}>
              {t("ld.k.paste.text")}
            </label>
            <textarea id="k-text" className={fieldTextarea} rows={5} maxLength={MAX_PASTE_CHARS} value={text} onChange={(e) => setText(e.target.value)} />
            <p className={fieldHelp}>{t("ld.k.paste.help")}</p>
          </div>
          <div>
            <button type="submit" className={btnMain} disabled={busy !== null || text.trim() === ""}>
              {busy === "paste" ? t("ld.k.adding") : t("ld.k.paste.add")}
            </button>
          </div>
        </form>
        <div>
          <label htmlFor="k-file" className={fieldLabel}>
            {t("ld.k.file")}
          </label>
          <input id="k-file" type="file" accept=".pdf,.docx,.txt,.md,.csv" className={fieldInput} disabled={busy !== null} onChange={(e) => void addFile(e.target.files?.[0])} />
          <p className={fieldHelp}>{t("ld.k.file.help")}</p>
        </div>
      </section>

      {error ? (
        <p role="alert" className={`${alertBox} !mt-0`}>
          {error.text}{" "}
          {error.mfa ? (
            <Link href={securityHref} className="font-semibold underline">
              {t("pc.err.mfa.link")}
            </Link>
          ) : null}
        </p>
      ) : null}

      {live.length > 0 ? (
        <section aria-labelledby="k-src-h" className="flex flex-col gap-3">
          <h3 id="k-src-h" className="font-display text-lg font-bold">
            {t("ld.k.sources")}
          </h3>
          <ul className="flex flex-col gap-3">
            {live.map((s) => (
              <li key={s.id} data-source={s.id} className={`${surface} flex flex-wrap items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <p className="break-words font-semibold">{s.title}</p>
                  <p className={`${mutedText} !mt-0`}>{t("ld.k.source.counts", { draft: s.facts.draft, approved: s.facts.approved })}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnMain} disabled={busy !== null || s.status === "drafted"} onClick={() => draft(s)}>
                    {busy === `draft-${s.id}` ? t("ld.k.reading") : t("ld.k.read")}
                  </button>
                  <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void run(`d-${s.id}`, () => actions.discard(s.id), (x) => setSources((cur) => cur.filter((c) => c.id !== x.id)))}>
                    {t("ld.k.discard")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className={`${mutedText} !mt-0`}>{t("ld.k.read.help")}</p>
        </section>
      ) : null}

      <section aria-labelledby="k-facts-h" className="flex flex-col gap-3">
        <h3 id="k-facts-h" className="font-display text-lg font-bold">
          {t("ld.k.facts", { n: approved })}
        </h3>
        {facts.length === 0 ? <p className={`${mutedText} !mt-0`}>{t("ld.k.facts.none")}</p> : null}
        {drafts.length > 0 ? <p className={`${okBox} !mt-0`}>{t("ld.k.facts.review", { n: drafts.length })}</p> : null}
        <ul className="flex flex-col gap-3">
          {facts.map((f) => {
            const price = needsSecondFactor(f.kind, f.text);
            return (
              <li key={f.id} data-fact={f.status} className={`${surface} flex flex-col gap-2`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={pillBrand}>{t(`ld.k.kind.${f.kind}` as "ld.k.kind.other")}</span>
                  <span className={pill(f.status)}>{t(`ld.k.status.${f.status}` as "ld.k.status.draft")}</span>
                  {f.edited ? <span className={pillNeutral}>{t("ld.k.edited")}</span> : null}
                </div>
                {editing?.id === f.id ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`k-e-${f.id}`} className={fieldLabel}>
                      {t("ld.k.fact.text")}
                    </label>
                    <textarea id={`k-e-${f.id}`} className={fieldTextarea} rows={3} maxLength={500} value={editing.text} onChange={(e) => setEditing({ id: f.id, text: e.target.value })} />
                    <div className="flex gap-2">
                      <button type="button" className={btnMain} disabled={busy !== null} onClick={saveEdit}>
                        {t("ld.k.save")}
                      </button>
                      <button type="button" className={btnQuiet} onClick={() => setEditing(null)}>
                        {t("ld.k.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="break-words text-base">{f.text}</p>
                )}
                {price && f.status === "draft" ? <p className={`${mutedText} !mt-0`}>{t(canPrice ? "ld.k.price.owner" : "ld.k.price.needs")}</p> : null}
                {editing?.id !== f.id ? (
                  <div className="flex flex-wrap gap-2">
                    {f.status !== "approved" ? (
                      <button type="button" className={btnMain} disabled={busy !== null || (price && !canPrice)} onClick={() => decide(f, "approve")}>
                        {t("ld.k.approve")}
                      </button>
                    ) : null}
                    <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => setEditing({ id: f.id, text: f.text })}>
                      {t("ld.k.edit")}
                    </button>
                    {f.status !== "rejected" ? (
                      <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => decide(f, "reject")}>
                        {t("ld.k.reject")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <form onSubmit={addManual} className={formStack}>
          <div>
            <label htmlFor="k-manual" className={fieldLabel}>
              {t("ld.k.manual")}
            </label>
            <textarea id="k-manual" className={fieldTextarea} rows={2} maxLength={500} value={manual} onChange={(e) => setManual(e.target.value)} />
            <p className={fieldHelp}>{t("ld.k.manual.help")}</p>
          </div>
          <div>
            <button type="submit" className={btnQuiet} disabled={busy !== null || manual.trim().length < 3}>
              {t("ld.k.manual.add")}
            </button>
          </div>
        </form>
      </section>
      <div className="flex flex-wrap gap-3">
        <Link href={nextHref} className={btnMain}>
          {t("ld.wiz.next")}
        </Link>
      </div>
    </div>
  );
}

