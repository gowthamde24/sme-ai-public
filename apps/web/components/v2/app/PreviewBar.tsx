import { setPreviewAction } from "@/app/app/preview/actions";

import { makeT, type Words } from "./words";

/**
 * The bar of the staging preview (PREVIEW_JOBS, lib/screens/preview.ts): drawn at the top of every signed-in page while THIS browser previews the Jobs and billing screens with sample data. Server-rendered: no script of its own.
 */
export function PreviewBar({ words }: { words: Words }) {
  const t = makeT(words);
  return (
    <div role="status" data-part="preview-bar" className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-text px-4 py-1.5 text-center text-sm font-semibold text-on-brand">
      <span>{t("preview.bar")}</span>
      <form action={setPreviewAction}>
        <input type="hidden" name="on" value="0" />
        <button type="submit" className="min-h-6 underline">
          {t("preview.bar_off")}
        </button>
      </form>
    </div>
  );
}
