import { setPreviewAction } from "@/app/app/preview/actions";
import { personaOf } from "@/lib/jobs/sample-fixtures";
import { PICKER_WORDS, pickerWordOf, type PreviewChoice } from "@/lib/screens/preview";

import { makeT, type Words } from "./words";

/**
 * The form of the staging preview page (lib/screens/preview.ts): ONE plain sentence with the choice inside (a select: my own business, or one sample business), then the button (on, or "Show this" once it is on), and Turn off. Server-rendered: no script of its own.
 * `choice` is what the cookie says now (null = the preview is off).
 */
export function PreviewPicker({ choice, words }: { choice: PreviewChoice | null; words: Words }) {
  const t = makeT(words);
  const on = choice !== null;
  const [before, after] = t("preview.show", { choice: "\u0000" }).split("\u0000");
  const state = choice?.kind === "sample" ? t("preview.state_sample", { business: personaOf(choice.type).business }) : choice ? t("preview.state_mine") : null;
  const btn = "inline-flex min-h-11 items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-base font-semibold text-on-brand";
  return (
    <>
      <p data-part="preview-state" className="m-0 text-base font-semibold">
        {on ? t("preview.on") : t("preview.off")}
      </p>
      {state ? (
        <p data-part="preview-showing" className="m-0 text-base text-muted">
          {state}
        </p>
      ) : null}
      <form action={setPreviewAction} className="flex flex-col gap-3">
        <input type="hidden" name="on" value="1" />
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-2 text-base">
          <span>{before}</span>
          <select name="choice" aria-label={t("preview.pick")} defaultValue={pickerWordOf(choice)} className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base text-ink">
            {PICKER_WORDS.map((w) => (
              <option key={w} value={w}>
                {t(`preview.pick.${w}`)}
              </option>
            ))}
          </select>
          <span>{after}</span>
        </p>
        <div>
          <button type="submit" className={btn}>
            {on ? t("preview.change") : t("preview.turn_on")}
          </button>
        </div>
      </form>
      {on ? (
        <form action={setPreviewAction}>
          <input type="hidden" name="on" value="0" />
          <button type="submit" className="min-h-11 text-base text-brand-text underline">
            {t("preview.turn_off")}
          </button>
        </form>
      ) : null}
    </>
  );
}
