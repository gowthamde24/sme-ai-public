"use client";

import * as React from "react";

import type { Done, Portal } from "@/lib/sources/types";

import { btnQuiet } from "../ui";
import { makeT, type Words } from "../words";
import type { CardsPost } from "./cards-post";
import { copyToClipboard } from "./CopyBox";

/** What the API writes where the shop's own lead address goes (app/lead_sources/portal_connections.py): the address is shown once, so only this page can put the real one in. */
export const MAIL_POINTER = "(your lead e-mail address from the Lead sources page)";
export const messageFor = (askText: string, address: string | null): string => (address ? askText.split(MAIL_POINTER).join(address) : askText);

/**
 * Inside the e-mail card: the portals that have no connector of their own (JustDial, 99acres, MagicBricks, Housing, Sulekha, TradeIndia). Each says the honest state ("Available through your portal account manager": their team switches
 * it on, we cannot) and has one button, "Copy message": the short text to send that team, with the shop's own lead address written in when this page holds it (it is shown once, so a page that does not hold it keeps the API's pointer).
 * Nothing is drawn when the list cannot be read.
 */
export function PortalsList({ words, post, address }: { words?: Words; post: CardsPost; address: string | null }) {
  const t = makeT(words);
  const [portals, setPortals] = React.useState<Portal[] | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void (async () => {
      const r = (await post({ op: "portals" })) as Done<Portal[]>;
      if (live && r.ok) setPortals(r.data);
    })();
    return () => {
      live = false;
    };
  }, [post]);
  if (!portals || portals.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-part="portals" aria-labelledby="sc-portals-h">
      <h4 id="sc-portals-h" className="m-0 text-[15px] font-semibold text-ink">{t("sc.portals.title")}</h4>
      <p className="m-0 text-sm text-muted">{t("sc.portals.how")}</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-line border-y border-line p-0">
        {portals.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5" data-portal={p.id}>
            <div className="min-w-0">
              <p className="m-0 text-[15px] font-semibold text-ink">{p.name}</p>
              <p className="m-0 text-sm text-muted">{t("sc.portal.state")}</p>
            </div>
            <button
              type="button"
              className={btnQuiet}
              aria-label={`${t("sc.portal.copy")}: ${p.name}`}
              onClick={() => void (async () => { const ok = await copyToClipboard(messageFor(p.askText, address)); setFailed(!ok); setCopied(ok ? p.id : null); })()}
            >
              {copied === p.id ? t("lsrc.copied") : t("sc.portal.copy")}
            </button>
          </li>
        ))}
      </ul>
      {failed ? <p role="alert" className="m-0 text-sm text-red-text">{t("lsrc.copy.fail")}</p> : null}
      {address ? null : <p className="m-0 text-sm text-muted">{t("sc.portal.noaddr")}</p>}
    </section>
  );
}
