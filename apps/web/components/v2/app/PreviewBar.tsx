import { setPreviewAction } from "@/app/app/preview/actions";

/**
 * The bar of the staging preview (PREVIEW_JOBS, lib/screens/preview.ts): drawn at the top of every signed-in page while THIS browser previews the Jobs and billing screens with sample data. Server-rendered: no script of its own.
 */
export function PreviewBar() {
  return (
    <div role="status" data-part="preview-bar" className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-text px-4 py-1.5 text-center text-sm font-semibold text-on-brand">
      <span>Preview, sample data. Nothing here is real, sent or saved.</span>
      <form action={setPreviewAction}>
        <input type="hidden" name="on" value="0" />
        <button type="submit" className="min-h-6 underline">
          Turn off
        </button>
      </form>
    </div>
  );
}
