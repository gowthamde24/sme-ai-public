import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

import { V2Root } from "@/components/v2/V2Root";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";

import { alertBox, backLink, link, mutedText, noteBox, okBox, pageH1, pageMain, pillAmber, pillBrand, pillGreen, pillInfo, pillNeutral, pillRed, surface } from "./ui";

/**
 * The shared v2 pieces of the app screens (workspace redesign, Batch 1A). They are forks of the pieces the old screens draw by hand
 * (ApiDown, NotShown, Notice, ActionResult): the SAME words, the new look. Nothing here reads data or decides access.
 * A migrated screen wraps its content in <V2Root> (its folder layout) and then uses these.
 */
export function ApiDownV2() {
  return (
    <main className={pageMain}>
      <p role="alert" className={alertBox}>
        Could not load this from the API. Try again shortly.
      </p>
      <p className="mt-4">
        <Link href="/app" className={link}>
          Back to your workspaces
        </Link>
      </p>
    </main>
  );
}

/** "This screen is not shown to your role": the way back, the title and one closed sentence. */
export function NotShownV2({ tenantId, tenantName, title, message }: { tenantId: string; tenantName: string; title: string; message: string }) {
  return (
    <main className={pageMain}>
      <p>
        <Link href={`/app/tenants/${tenantId}`} className={backLink}>
          ← {tenantName}
        </Link>
      </p>
      <h1 className={pageH1}>{title}</h1>
      <p className={mutedText}>{message}</p>
    </main>
  );
}

/** A closed sentence of ours that every screen of a kind shows (for example "nothing is sent"). */
export function NoticeV2({ children }: { children: ReactNode }) {
  return (
    <p role="note" className={noteBox}>
      {children}
    </p>
  );
}

export type ActionResultState = { error?: string; ok?: boolean; message?: string } | undefined;

/** The outcome of a form: our own short sentence (never text from the API or the customer). */
export function ActionResultV2({ state }: { state: ActionResultState }) {
  if (state?.error)
    return (
      <p role="alert" className={alertBox}>
        {state.error}
      </p>
    );
  if (state?.ok && state.message)
    return (
      <p role="status" className={okBox}>
        {state.message}
      </p>
    );
  return null;
}

/** Back link, h1 and (optionally) the role line of a page. The role line stays until the clean-up batch (tests pin it). */
export function PageHeader({ back, title, role, children }: { back?: { href: string; label: string }; title: string; role?: string; children?: ReactNode }) {
  return (
    <header>
      {back ? (
        <p>
          <Link href={back.href} className={backLink}>
            ← {back.label}
          </Link>
        </p>
      ) : null}
      <h1 className={pageH1}>{title}</h1>
      {role ? (
        <p className={mutedText}>
          Your role: <strong>{role}</strong>
        </p>
      ) : null}
      {children}
    </header>
  );
}

export function Panel({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={`mt-6 ${surface}`}>
      {children}
    </section>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "green" | "amber" | "red" | "info"; children: ReactNode }) {
  return <span className={TONES[tone]}>{children}</span>;
}
const TONES = { neutral: pillNeutral, brand: pillBrand, green: pillGreen, amber: pillAmber, red: pillRed, info: pillInfo } as const;

/**
 * The wrapper a migrated screen's folder layout uses: a v2 island for the screen's own content (plan 2.9). It reads the theme cookie like the
 * frame does, so the screen follows the choice after a reload (its words are English until the language track, so it says lang=en); the theme button keeps every island in step without one.
 */
export async function ScreenIsland({ children }: { children: ReactNode }) {
  const jar = await cookies();
  return (
    <V2Root theme={readTheme(jar.get(THEME_COOKIE)?.value)} lang="en" className="min-h-[60dvh] bg-transparent bg-none">
      {children}
    </V2Root>
  );
}
