"use client";

import { useEffect, useId, useRef, useState } from "react";

import { type SearchOutcome, searchStaffAction } from "@/app/staff/actions";
import { STATUS, CHANNEL, PRIORITY, TEXT } from "@/lib/staff/words";

import { StaffIcon } from "./StaffIcon";
import { ViewButton } from "./ViewButton";

/**
 * The Cmd+K box (and Ctrl+K): business, phone (the business's own), invoice or ticket, asked of `GET /v1/admin/search?q=` (2 to 80 characters; what was typed is not stored). Results are a small list under the box, the data as the API returned it
 * (already masked). A business hit has the same read-only "View" (reason first). Esc clears. A server component cannot do this: it is the one small script of the page.
 */
export function StaffSearch() {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  // the answer keeps the text it was asked for: a newer, shorter text simply draws nothing (no state is reset inside an effect)
  const [answer, setAnswer] = useState<{ q: string; outcome: SearchOutcome } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      searchStaffAction(text).then((outcome) => live && setAnswer({ q: text, outcome })).catch(() => live && setAnswer({ q: text, outcome: { ok: false, failure: "unavailable" } }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const current = answer !== null && answer.q === q.trim() ? answer.outcome : null;
  const found = current?.ok ? current.results : null;
  const none = found && found.businesses.length + found.invoices.length + found.tickets.length === 0;
  const show = open && q.trim().length >= 2 && current !== null;

  return (
    <div className="sc-search" role="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <label>
        <StaffIcon name="search" size={16} />
        <span className="sc-sr" id={`${id}-l`}>{TEXT.searchLabel}</span>
        <input
          ref={input}
          type="search"
          value={q}
          maxLength={80}
          placeholder={TEXT.searchPlaceholder}
          aria-labelledby={`${id}-l`}
          aria-controls={`${id}-r`}
          aria-expanded={show}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setOpen(false); } }}
        />
        <kbd aria-hidden="true">⌘K</kbd>
      </label>
      {show ? (
        <div className="sc-results" id={`${id}-r`} aria-live="polite">
          {current && !current.ok ? <p className="sc-empty">{TEXT.searchFailed}</p> : null}
          {none ? <p className="sc-empty">{TEXT.searchNone}</p> : null}
          {found && found.businesses.length > 0 ? (
            <div>
              <h4>{TEXT.searchBusinesses}</h4>
              {found.businesses.map((b) => (
                <div className="sc-hit" key={b.tenantId}>
                  <div>
                    <b>{b.name}</b>
                    <span className="sc-sub">{[b.town, STATUS[b.status]].filter(Boolean).join(" · ")}</span>
                  </div>
                  <ViewButton tenantId={b.tenantId} name={b.name} />
                </div>
              ))}
            </div>
          ) : null}
          {found && found.invoices.length > 0 ? (
            <div>
              <h4>{TEXT.searchInvoices}</h4>
              {found.invoices.map((i) => (
                <div className="sc-hit" key={i.number}>
                  <div>
                    <b>{i.number}</b>
                    <span className="sc-sub">{i.businessName}</span>
                  </div>
                  <span className="sc-amount">{i.totalText}</span>
                </div>
              ))}
            </div>
          ) : null}
          {found && found.tickets.length > 0 ? (
            <div>
              <h4>{TEXT.searchTickets}</h4>
              {found.tickets.map((t, n) => (
                <div className="sc-hit" key={`${t.businessName}-${n}`}>
                  <div>
                    <b>{t.subject}</b>
                    <span className="sc-sub">{t.businessName} · {CHANNEL[t.channel] ?? t.channel} · {PRIORITY[t.priority]}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
