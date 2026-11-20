import { BatteryFull, Signal, Wifi } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Our own drawing of a phone for the home page's demo (owner, 21 Nov 2026: "use a black screen on the mobile"): a black body with a thin bezel, a dynamic-island pill, a status bar (9:41, signal, Wi-Fi, battery) and a home bar, with
 * the screen's content inside. Crisp CSS and SVG icons only (design/home3.css, `.h3-dp-*`); no logo and no copied shape. It is an illustration of a phone screen, so the audit's 14 px rule does not apply to what is drawn on it
 * (`data-illustration`), though the demo keeps its text at 14 px or more. A server component.
 */
export function DarkPhone({ children, part }: { children: ReactNode; part: string }) {
  return (
    <div className="h3-dp" data-part={part} data-illustration="">
      <span className="h3-dp-island" aria-hidden="true" />
      <div className="h3-dp-status" aria-hidden="true">
        <span>9:41</span>
        <span className="h3-dp-status-icons">
          <Signal size={15} strokeWidth={2.4} />
          <Wifi size={15} strokeWidth={2.4} />
          <BatteryFull size={18} strokeWidth={2} />
        </span>
      </div>
      <div className="h3-dp-screen">{children}</div>
      <span className="h3-dp-home" aria-hidden="true" />
    </div>
  );
}
