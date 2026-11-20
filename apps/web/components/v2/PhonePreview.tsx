import { Check, CheckCheck, ChevronLeft, MoreVertical, Mic, Phone, PhoneOff, Video } from "lucide-react";
import type { ReactNode } from "react";

/**
 * THE PHONE (owner, 19 Nov 2026: "wherever we show chat, use mobile layout", "like an iPhone or Samsung S26 Ultra mobile screen"): every chat or call shown as an example or a preview is drawn as a real phone screen: our own drawing of a modern flagship phone
 * (a tall 19.5:9 screen, thin even bezels, large rounded corners, a punch-hole camera, a thin metal edge, a soft shadow, a status bar and a home bar), with a WhatsApp-style header, bubbles with time and ticks, and the input bar, at phone sizes (390 px wide, 16 px text).
 * `variant="full"` is the whole phone (the landing's demos); `"peek"` is the top of a phone, open at the bottom (cards, the builder's preview, the plan card's words). On a phone-sized screen the frame goes away and the content is shown as it is. Light, dark, or `auto` (follows the page).
 * A SERVER component with no script: the words come from the caller (they are the person's language already). The real Chats page of the app does NOT use this (desktop = list + conversation). The style is design/phone-preview.css.
 */
export type PhoneTheme = "auto" | "light" | "dark";
export type PhoneVariant = "full" | "peek";

type Common = { variant?: PhoneVariant; /** Keep the frame on a narrow screen too (the landing page shows the same phone at every width). */ keepFrame?: boolean; theme?: PhoneTheme; /** The clock of the status bar. */ time?: string; /** The bubbles rise one after another (transform and opacity only). */ animate?: boolean; className?: string };

const Signal = () => (
  <svg viewBox="0 0 18 13" aria-hidden="true" fill="currentColor">
    <rect x="0" y="9" width="3" height="4" rx="1" />
    <rect x="5" y="6" width="3" height="7" rx="1" />
    <rect x="10" y="3" width="3" height="10" rx="1" />
    <rect x="15" y="0" width="3" height="13" rx="1" />
  </svg>
);
const WifiIcon = () => (
  <svg viewBox="0 0 17 13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1.2 4.6a11 11 0 0 1 14.6 0" />
    <path d="M3.9 7.6a7 7 0 0 1 9.2 0" />
    <circle cx="8.5" cy="10.8" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);
const Battery = () => (
  <svg viewBox="0 0 27 13" aria-hidden="true" fill="none">
    <rect x="0.7" y="0.7" width="22.6" height="11.6" rx="3.4" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" />
    <rect x="2.4" y="2.4" width="17.6" height="8.2" rx="2" fill="currentColor" />
    <path d="M24.8 4.4v4.2c.9-.3 1.5-1.2 1.5-2.1s-.6-1.8-1.5-2.1z" fill="currentColor" fillOpacity="0.5" />
  </svg>
);

function Shell({ variant = "full", theme = "auto", time = "9:41", animate = false, keepFrame = false, className = "", children }: Common & { children: ReactNode }) {
  return (
    <div className={`pp ${className}`.trim()} data-pp-variant={variant} data-pp-theme={theme} {...(animate ? { "data-pp-animate": "" } : {})} {...(keepFrame ? { "data-pp-keep": "" } : {})} data-part="phone-preview" data-illustration="">
      <div className="pp-frame">
        <div className="pp-screen">
          <span className="pp-cam" aria-hidden="true" />
          <div className="pp-status" aria-hidden="true">
            <span>{time}</span>
            <span className="pp-status-icons">
              <Signal />
              <WifiIcon />
              <Battery />
            </span>
          </div>
          {children}
          <span className="pp-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/** A WhatsApp-style chat: the shop's header, the bubbles (`PpBubble`), the input bar. `name` = the shop, `sub` = "Business account" in the person's language, `placeholder` = the input's word. */
export function PhoneChat({ name, sub, placeholder = "Message", children, ...rest }: Common & { name: string; sub?: string; placeholder?: string; children: ReactNode }) {
  return (
    <Shell {...rest}>
      <div className="pp-head">
        <ChevronLeft aria-hidden="true" size={24} strokeWidth={2.2} />
        <span className="pp-avatar" aria-hidden="true">
          {[...name][0]?.toUpperCase() ?? "?"}
        </span>
        <div className="pp-who">
          <p className="pp-name">{name}</p>
          {sub ? <p className="pp-sub">{sub}</p> : null}
        </div>
        <span className="pp-head-icons">
          <Video aria-hidden="true" size={22} strokeWidth={2} />
          <Phone aria-hidden="true" size={20} strokeWidth={2} />
          <MoreVertical aria-hidden="true" size={22} strokeWidth={2} />
        </span>
      </div>
      <div className="pp-body">{children}</div>
      <div className="pp-input" aria-hidden="true">
        <span className="pp-input-box">{placeholder}</span>
        <span className="pp-mic">
          <Mic size={20} strokeWidth={2.2} />
        </span>
      </div>
    </Shell>
  );
}

/** A call as the phone shows it: who is calling, how long, and the words said (`PpLine`). */
export function PhoneCall({ name, sub, captions, children, ...rest }: Common & { name: string; sub: string; /** The chip's words ("Live captions"), in the person's language. */ captions?: string; children: ReactNode }) {
  return (
    <Shell {...rest}>
      <div className="pp-call">
        <span className="pp-avatar" aria-hidden="true">
          {[...name][0]?.toUpperCase() ?? "?"}
        </span>
        <p className="pp-call-name">{name}</p>
        <p className="pp-call-sub">{sub}</p>
        {captions ? <span className="pp-captions">{captions}</span> : null}
        <div className="pp-lines">{children}</div>
        <span className="pp-call-end" aria-hidden="true">
          <PhoneOff size={26} strokeWidth={2.2} />
        </span>
      </div>
    </Shell>
  );
}

/** One bubble: `from="them"` is the other side (the shop, in the owner's previews), `from="me"` the person's own; `time` and the ticks sit at its corner (`ticks`: sent, delivered or read (blue)). */
export function PpBubble({ from, time, ticks, tail = false, children }: { from: "me" | "them"; time?: string; ticks?: "sent" | "read"; /** The small tail: on the first bubble of a run, like the real app. */ tail?: boolean; children: ReactNode }) {
  return (
    <div className="pp-b" data-from={from} {...(tail ? { "data-tail": "" } : {})} {...(ticks === "sent" ? { "data-sent": "" } : {})}>
      <p>{children}</p>
      {time || ticks ? (
        <span className="pp-meta">
          {time ? <span>{time}</span> : null}
          {ticks === "sent" ? <Check aria-hidden="true" size={13} strokeWidth={2.6} /> : ticks === "read" ? <CheckCheck aria-hidden="true" size={15} strokeWidth={2.6} /> : null}
        </span>
      ) : null}
    </div>
  );
}

/** The day chip ("Today"). */
export const PpDay = ({ children }: { children: ReactNode }) => <span className="pp-day">{children}</span>;

/** One caption line of a call: `from="them"` is the other side (the assistant, on the left, a neutral bubble), `"me"` the person (on the right); `who` is the small speaker label ("AI assistant", "You"), in the person's language. */
export const PpLine = ({ from, who, children }: { from: "me" | "them"; who: string; children: ReactNode }) => (
  <p className="pp-line" data-from={from}>
    <span className="pp-line-who">{who}</span>
    <span>{children}</span>
  </p>
);
