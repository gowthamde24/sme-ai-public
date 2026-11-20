import Link from "next/link";
import { notFound } from "next/navigation";

import { PreviewPicker } from "@/components/v2/app/PreviewPicker";
import { makeT } from "@/components/v2/app/words";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { requireUser } from "@/lib/auth/session";
import { previewAllowed, previewChoice } from "@/lib/screens/preview";


export const metadata = { title: `Preview · ${BRAND_NAME}`, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * /app/preview (STAGING only, planner 19 Nov 2026): "Preview Jobs". One switch for THIS browser, and what it shows: my own business (the real routes, sample data only where a route is still 404) or a sample business (made-up data of that type); nobody else sees a change.
 * Anywhere that does not allow it (production) this is a plain 404. Off by default.
 */
export default async function PreviewPage() {
  if (!previewAllowed()) notFound();
  await requireUser();
  const words = wordsFor(await getLang(), ["preview."]);
  const t = makeT(words);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8 text-ink">
      <h1 className="m-0 font-display text-2xl font-bold">{t("preview.title")}</h1>
      <p className="m-0 text-base text-muted">{t("preview.intro")}</p>
      <PreviewPicker choice={previewChoice()} words={words} />
      <Link href="/app" className="text-base text-brand-text underline">
        {t("preview.back")}
      </Link>
    </main>
  );
}
