import Link from "next/link";

import { staffSignOutAction } from "@/app/staff/actions";
import { TEXT } from "@/lib/staff/words";

/** A whole-page plain message of the staff console: a title, one sentence, optionally one button. Never a detail of why (no API message, no code). */
export function PlainScreen({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="sc-plain" data-part="plain">
      <div role="alert">
        <h1>{title}</h1>
        <p>{body}</p>
        {children}
      </div>
    </div>
  );
}

/** The same inside the console (the menu is there): used where only one part of the area is refused. */
export function InlineScreen({ title, body, keep }: { title: string; body: string; keep: string }) {
  return (
    <div className="sc-card" data-part="inline-screen" role="alert">
      <div className="sc-ch"><h3>{title}</h3></div>
      <p className="sc-empty">{body}</p>
      <p className="sc-empty"><Link className="sc-back" href={`/staff${keep}`}>← {TEXT.backToOverview}</Link></p>
    </div>
  );
}

export function SignedOutScreen() {
  return (
    <PlainScreen title={TEXT.signedOutTitle} body={TEXT.signedOutBody}>
      <form action={staffSignOutAction}>
        <button type="submit" className="sc-btn sc-primary">{TEXT.signedOutButton}</button>
      </form>
    </PlainScreen>
  );
}

export const NoAccessScreen = () => <PlainScreen title={TEXT.noAccessTitle} body={TEXT.noAccessBody} />;

export function UnavailableScreen() {
  return (
    <PlainScreen title={TEXT.unavailableTitle} body={TEXT.unavailableBody}>
      <Link className="sc-btn" href="/staff">{TEXT.tryAgain}</Link>
    </PlainScreen>
  );
}
