"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";


type Words = { t1: string; t2: string; t3: string; t4: string; kyc: string; yes: string; added: string; done: string; wait: string };

/**
 * The trust row under the plans: four mini cards, each a tiny picture of the real product, still (no motion; opacity and transform, about 1.5 s, "reduce motion" or no JavaScript = the finished state at once):
 * the business number filling in with its KYC chip, a consent box ticked and "Added to your list", a STOP and its reply, and the quiet hours holding a late message till morning. The moment is a picture ([data-illustration], hidden from assistive
 * technology); the card's title is the real text and carries the meaning. The numbers are examples (digits are masked); the hours are the business's own, so the card says "till morning", never a fixed time of ours.
 */
export function TrustRow({ w, moon }: { w: Words; /** The moon, drawn on the server (no icon code for it in the page's script). */ moon: ReactNode }) {
  return (
    <ul className="h4-trust" data-part="trust">
      <li className="h4-mini" data-trust="1">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <span className="h4-num">
            <span className="h4-s h4-d0">080</span> <span className="h4-s h4-d1">4•••</span> <span className="h4-s h4-d2">••12</span>
          </span>
          <span className="h4-ok h4-s h4-d4">
            <Check size={12} strokeWidth={3} /> {w.kyc}
          </span>
        </div>
        <p className="h4-mini-t">{w.t1}</p>
      </li>
      <li className="h4-mini" data-trust="2">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <span className="h4-cb">
            <span className="h4-box">
              <Check className="h4-s h4-tick h4-d1" size={12} strokeWidth={3.5} />
            </span>
            {w.yes}
          </span>
          <span className="h4-ok h4-s h4-d3">
            {w.added}
          </span>
        </div>
        <p className="h4-mini-t">{w.t2}</p>
      </li>
      <li className="h4-mini" data-trust="3">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <span className="h4-b h4-b-out h4-s h4-d0">
            STOP
          </span>
          <span className="h4-b h4-b-in h4-s h4-d3">
            {w.done} <Check size={12} strokeWidth={3} className="h4-chk" />
          </span>
        </div>
        <p className="h4-mini-t">{w.t3}</p>
      </li>
      <li className="h4-mini" data-trust="4">
        <div className="h4-moment" data-illustration="" aria-hidden="true">
          <span className="h4-time h4-s h4-d0">
            {moon} 9:40 pm
          </span>
          <span className="h4-wait h4-s h4-d3">
            {w.wait}
          </span>
        </div>
        <p className="h4-mini-t">{w.t4}</p>
      </li>
    </ul>
  );
}
