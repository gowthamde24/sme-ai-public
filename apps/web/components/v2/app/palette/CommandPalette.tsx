"use client";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { isVoiceLang, type VoiceLang } from "@/lib/browser-voice/protocol";
import { VoiceMic } from "../voice-input/LazyVoiceMic";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";

import { SpriteIcon } from "../icons";
import { withPackWords, type Labels } from "../labels";
import { hrefOf, menuGroups, type PackFrame, type Role } from "../nav";
import { ownWords, rowWord } from "../nav-words";
import { ACTIONS, SETTINGS_PARTS, matchItems, parseRecent, recordHref, type PaletteItem, type PaletteNames } from "./palette";

type Group = { key: string; title: string; items: PaletteItem[] };
const ADMINS: readonly Role[] = ["owner", "admin"];

/**
 * The command palette (owner, 6 Nov 2026): ⌘K, Ctrl+K or the top bar's search opens it; it never jumps to the assistant on its own. A glass overlay in the middle (the whole screen on a phone), the cursor in the box, Esc closes, ↑↓ and Enter choose.
 * Empty: "Go to" (every menu page, the same routes as the menu) and "Recent" (the last five pages opened, per person and workspace, in this browser). Typing: Pages (with the Settings parts), Records (C1's search: leads,
 * customers, quotes, orders, students; top 5 each), Actions, and always last "Ask the assistant: <text>", the only item that goes to the assistant. Labels match in every language of the app and in English.
 */
/** The app's language, from the page (the search box sits in the frame, above the workspace's own voice setup). */
const appLanguage = (): VoiceLang => {
  const l = typeof document === "undefined" ? "en" : document.documentElement.lang.slice(0, 2);
  return isVoiceLang(l) ? l : "en";
};

export function CommandPalette({ tenantId, role, pack, labels, names, words, recentKey, onClose }: { tenantId: string; role: Role; pack: PackFrame | null; labels: Labels; names: PaletteNames; words: Readonly<Record<string, string>>; recentKey: string; onClose: () => void }) {
  const router = useRouter();
  const base = `/app/tenants/${tenantId}`;
  const w = (k: string, vars?: Record<string, string>) => {
    const text = words[k] ?? k;
    return vars ? text.replace(/\{(\w+)\}/g, (m, n: string) => vars[n] ?? m) : text;
  };
  const input = React.useRef<HTMLInputElement>(null);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);

  // the pages: the menu as this person has it (its words in the person's language, with the business type's own), then the parts of Settings
  const pages = React.useMemo<PaletteItem[]>(() => {
    const shown = withPackWords(labels, pack);
    const own = ownWords(pack, labels);
    const rows = menuGroups(role, pack).flatMap((g) => g.items);
    const out: PaletteItem[] = rows.map((r) => {
      const label = rowWord(r, shown, own);
      return { id: r.id, kind: "page", label, names: [label, ...(names[r.id] ?? [])], href: hrefOf(r, tenantId) };
    });
    for (const p of SETTINGS_PARTS) {
      if ("admins" in p && p.admins && !ADMINS.includes(role)) continue;
      const n = names[`settings:${p.section}`] ?? [];
      if (n[0]) out.push({ id: `settings:${p.section}`, kind: "page", label: n[0], names: [...n, ...(names.settings ?? [])], href: `${base}/settings?section=${p.section}`, sub: names.settings?.[0] });
    }
    return out;
  }, [labels, pack, role, names, tenantId, base]);
  const rowIds = React.useMemo(() => new Set(pages.map((p) => p.id)), [pages]);
  const actions = React.useMemo<PaletteItem[]>(
    () =>
      ACTIONS.filter((a) => (a.needs === null || rowIds.has(a.needs)) && (!a.admins || ADMINS.includes(role))).flatMap((a) => {
        const n = names[`action:${a.id}`] ?? [];
        return n[0] ? [{ id: `action:${a.id}`, kind: "action" as const, label: n[0], names: n, href: `${base}${a.path}` }] : [];
      }),
    [rowIds, role, names, base],
  );
  const recent = React.useMemo<PaletteItem[]>(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(recentKey);
    } catch {
      raw = null;
    }
    return parseRecent(raw)
      .filter((r) => r.href.startsWith(base))
      .map((r, i) => ({ id: `recent:${i}`, kind: "recent" as const, label: r.label, names: [r.label], href: r.href }));
  }, [recentKey, base]);

  // the records: C1's search, a moment after the typing stops (2 to 80 characters); kept with the text they answer, so an older answer never shows under newer typing
  const asked = q.trim();
  const askable = asked.length >= 2 && asked.length <= 80;
  const [found, setFound] = React.useState<{ q: string; items: PaletteItem[] } | null>(null);
  React.useEffect(() => {
    if (!askable) return;
    const ctl = new AbortController();
    const id = window.setTimeout(() => {
      fetch(`${base}/search?${new URLSearchParams({ q: asked }).toString()}`, { signal: ctl.signal, credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((json: { items?: { kind: string; id: string; title: string; sub: string | null }[] }) => {
          const items = (json.items ?? []).flatMap((it) => {
            const href = recordHref(base, it.kind, it.id);
            return href ? [{ id: `record:${it.kind}:${it.id}`, kind: "record" as const, label: it.title, names: [it.title], href, ...(it.sub ? { sub: it.sub } : {}) }] : [];
          });
          setFound({ q: asked, items });
        })
        .catch(() => {
          if (!ctl.signal.aborted) setFound({ q: asked, items: [] });
        });
    }, 200);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
  }, [asked, askable, base]);
  const records = askable && found?.q === asked ? found.items : [];
  const searching = askable && found?.q !== asked;

  const text = q.trim();
  const groups: Group[] = text
    ? [
        { key: "pages", title: w("palette.pages"), items: matchItems(text, pages).slice(0, 8) },
        { key: "records", title: w("palette.records"), items: records },
        { key: "actions", title: w("palette.actions"), items: matchItems(text, actions).slice(0, 6) },
        { key: "ask", title: "", items: [{ id: "ask", kind: "ask" as const, label: w("palette.ask", { text }), names: [], href: `${base}/talk?${new URLSearchParams({ ask: text }).toString()}` }] },
      ].filter((g) => g.items.length > 0)
    : [
        { key: "goto", title: w("palette.goto"), items: pages.filter((p) => !p.id.startsWith("settings:")) },
        { key: "recent", title: w("palette.recent"), items: recent },
      ].filter((g) => g.items.length > 0);
  const flat = groups.flatMap((g) => g.items);
  const current = Math.min(active, Math.max(0, flat.length - 1));

  const open = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    router.push(it.href);
  };
  React.useEffect(() => {
    input.current?.focus();
  }, []);
  React.useEffect(() => {
    document.getElementById(`palette-opt-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + flat.length) % Math.max(1, flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(flat[current]);
    }
  };

  let index = -1;
  // drawn at the top of the app's root, not inside the top bar (a sticky header is its own layer: the phone's bottom bar and the orb would sit over it); above the menus and panels, under the live voice and the cookie banner
  return createPortal(
    <div className="fixed inset-0 z-[65]" data-palette="" onKeyDown={onKey}>
      <div aria-hidden="true" className="absolute inset-0 bg-charcoal/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={w("frame.search")} className="v2-glass absolute inset-0 flex flex-col overflow-hidden border-line md:inset-x-0 md:top-[12vh] md:bottom-auto md:mx-auto md:max-h-[70vh] md:w-[min(40rem,calc(100%-2rem))] md:rounded-2xl md:border md:shadow-[var(--v2-shadow-pop)]">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <SpriteIcon id="search" className="size-5 shrink-0 text-muted" />
          <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat.length ? `palette-opt-${current}` : undefined}
            aria-autocomplete="list"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder={w("frame.search")}
            className="min-h-14 w-full min-w-0 bg-transparent pr-14 text-base text-ink outline-none placeholder:text-muted"
          />
          <VoiceMic target={input} inline voice={{ words, url: "", tokenUrl: "", speechUrl: `${base}/speech-transcribe`, language: appLanguage(), languageNames: CALL_LANG_NAMES }} />
          </div>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-muted hover:bg-surface-2">
            {w("palette.close")}
          </button>
        </div>
        <div id="palette-list" role="listbox" aria-label={w("frame.search")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.title || undefined} className="mb-1">
              {g.title ? <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p> : null}
              {g.items.map((it) => {
                index += 1;
                const i = index;
                const on = i === current;
                return (
                  <div
                    key={it.id}
                    id={`palette-opt-${i}`}
                    role="option"
                    aria-selected={on}
                    data-palette-item={it.id}
                    onMouseMove={() => setActive(i)}
                    onClick={() => open(it)}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-base ${on ? "bg-brand-bg text-brand-text" : "text-ink"} ${it.kind === "ask" ? "font-semibold" : ""}`}
                  >
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{it.label}</span>
                    {it.sub ? <span className="shrink-0 truncate text-sm text-muted">{it.sub}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
          {searching ? <p className="px-3 py-2 text-sm text-muted">{w("palette.searching")}</p> : null}
        </div>
        <p className="hidden border-t border-line px-4 py-2 text-xs text-muted md:block">{w("palette.keys")}</p>
      </div>
    </div>,
    // inside the app's own root (its theme, fonts and styles live there), not the bare body
    document.querySelector('[data-ui="v2"]') ?? document.body,
  );
}
