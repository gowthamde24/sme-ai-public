import Link from "next/link";
import { notFound } from "next/navigation";

import { BRAND_NAME } from "@/design/brand";
import { requireUser } from "@/lib/auth/session";
import { previewAllowed, previewOn } from "@/lib/screens/preview";

import { setPreviewAction } from "./actions";

export const metadata = { title: `Preview · ${BRAND_NAME}`, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * /app/preview (STAGING only, planner 19 Nov 2026): "Preview Jobs (sample data)". One switch for THIS browser: the Jobs screens and the new billing screens appear with made-up data; nothing is sent, charged or saved, and nobody else sees a change.
 * Anywhere that does not allow it (production) this is a plain 404. Off by default.
 */
export default async function PreviewPage() {
  if (!previewAllowed()) notFound();
  await requireUser();
  const on = previewOn();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8 text-ink">
      <h1 className="m-0 font-display text-2xl font-bold">Preview Jobs (sample data)</h1>
      <p className="m-0 text-base text-muted">
        Shows the new Jobs screens and the new billing screens in this browser only, with made-up data. Nothing is sent, charged or saved, and nobody else sees any change. Turn it off here or from the bar at the top.
      </p>
      <p data-part="preview-state" className="m-0 text-base font-semibold">
        {on ? "The preview is ON in this browser." : "The preview is off."}
      </p>
      <form action={setPreviewAction}>
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full border border-brand-edge bg-brand px-5 text-base font-semibold text-on-brand">
          {on ? "Turn the preview off" : "Turn the preview on"}
        </button>
      </form>
      <Link href="/app" className="text-base text-brand-text underline">
        Back to your workspaces
      </Link>
    </main>
  );
}
