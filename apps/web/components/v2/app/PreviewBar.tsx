import { setPreviewAction } from "@/app/app/preview/actions";
import { personaOf } from "@/lib/jobs/sample-fixtures";
import type { PreviewChoice } from "@/lib/screens/preview";

import { makeT, type Words } from "./words";

/**
 * The bar of the staging preview (PREVIEW_JOBS, lib/screens/preview.ts): drawn at the top of every signed-in page while THIS browser previews the Jobs and billing screens. It says the truth about what is shown: "my business" = the real data where the API has it and
 * sample data (each part marked "Sample") where it does not yet; a sample business = made-up data only. Server-rendered: no script of its own.
 */
export function PreviewBar({ words, choice }: { words: Words; choice: PreviewChoice }) {
  const t = makeT(words);
  return (
    <div role="status" data-part="preview-bar" className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-text px-4 py-1.5 text-center text-sm font-semibold text-on-brand">
      <span>{choice.kind === "sample" ? t("preview.bar_sample", { business: personaOf(choice.type).business }) : t("preview.bar")}</span>
      <form action={setPreviewAction}>
        <input type="hidden" name="on" value="0" />
        <button type="submit" className="min-h-6 underline">
          {t("preview.bar_off")}
        </button>
      </form>
    </div>
  );
}
