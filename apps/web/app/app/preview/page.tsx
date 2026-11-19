import Link from "next/link";
import { notFound } from "next/navigation";

import { makeT } from "@/components/v2/app/words";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
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
  const t = makeT(wordsFor(await getLang(), ["preview."]));
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8 text-ink">
      <h1 className="m-0 font-display text-2xl font-bold">{t("preview.title")}</h1>
      <p className="m-0 text-base text-muted">{t("preview.intro")}</p>
      <p data-part="preview-state" className="m-0 text-base font-semibold">
        {on ? t("preview.on") : t("preview.off")}
      </p>
      <form action={setPreviewAction}>
        <input type="hidden" name="on" value={on ? "0" : "1"} />
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full border border-brand-edge bg-brand px-5 text-base font-semibold text-on-brand">
          {on ? t("preview.turn_off") : t("preview.turn_on")}
        </button>
      </form>
      <Link href="/app" className="text-base text-brand-text underline">
        {t("preview.back")}
      </Link>
    </main>
  );
}
