import { ArrowRight, Check, Moon } from "lucide-react";

import type { SiteT } from "@/i18n/site";

/**
 * "Built in from day one": a calm bento of what the product does on its own, every card a STILL snapshot of the real thing (nothing moves; owner, 21 Nov 2026). One wide card: the business numbers, the digits masked (examples). One timeline: a busy line, tried
 * again later, connected (what the call settings really do: retry after a busy line or no answer, inside the calling hours, up to the set number of tries; the times are an example and say so). Three small cards: a ticked consent, a STOP and its reply, the quiet
 * hours holding a late message till morning ("till morning": the hours are the business's own). The moments are pictures (aria-hidden) with their title as real text; the timeline is real text. Server markup only.
 */
export function Bento({ t }: { t: SiteT }) {
  const arrow = <ArrowRight className="h4-bn-arrow" size={16} strokeWidth={2.4} aria-hidden="true" />;
  return (
    <div className="h4-bento" data-part="built-in">
      <div className="h4-card h4-bn h4-bn-wide" data-bento="numbers">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <p className="h4-bn-row">
            <span className="h4-num">080 4••• ••12</span>
            <span className="h4-ok">
              <Check size={14} strokeWidth={3} /> {t("h4.m.kyc")}
            </span>
          </p>
          <p className="h4-bn-row">
            <span className="h4-num">040 6••• ••37</span>
            <span className="h4-bn-tag">{t("h4.m.extra")}</span>
          </p>
        </div>
        <h3 className="h4-h3">{t("h4.tr.1")}</h3>
      </div>
      <div className="h4-card h4-bn h4-bn-wide" data-bento="retry">
        <ol className="h4-tl" data-part="timeline">
          <li>
            <b>10:00</b> {t("h4.bt.1")}
          </li>
          <li>{t("h4.bt.2")}</li>
          <li>
            <b>5:00 pm</b> {t("h4.bt.3")}
          </li>
        </ol>
        <h3 className="h4-h3">
          {t("h4.bt.t")} <span className="h4-bn-tag">{t("h4.eg")}</span>
        </h3>
      </div>
      <div className="h4-card h4-bn" data-bento="consent">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <span className="h4-cb">
            <span className="h4-box">
              <Check size={12} strokeWidth={3.5} />
            </span>
            {t("h4.m.yes")}
          </span>
          {arrow}
          <span className="h4-ok">{t("h4.m.added")}</span>
        </div>
        <h3 className="h4-h3">{t("h4.tr.2")}</h3>
      </div>
      <div className="h4-card h4-bn" data-bento="stop">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <span className="h4-b h4-b-out">STOP</span>
          {arrow}
          <span className="h4-b h4-b-in">
            {t("h4.m.done")} <Check size={14} strokeWidth={3} className="h4-chk" />
          </span>
        </div>
        <h3 className="h4-h3">{t("h4.tr.3")}</h3>
      </div>
      <div className="h4-card h4-bn" data-bento="quiet">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <span className="h4-time">
            <Moon size={14} strokeWidth={2.4} /> 9:40 pm
          </span>
          {arrow}
          <span className="h4-wait">{t("h4.m.wait")}</span>
        </div>
        <h3 className="h4-h3">{t("h4.tr.4")}</h3>
      </div>
    </div>
  );
}
