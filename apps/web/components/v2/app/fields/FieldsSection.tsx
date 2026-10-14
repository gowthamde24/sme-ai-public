import type { AppT } from "@/i18n/app";
import { textIn } from "@/lib/packs/registry";
import type { FieldEntity, FieldKind, WorkspaceField } from "@/lib/packs/types";

import { card, errorLine, field, help, label, okLine, primary, secondary } from "../visits/styles";

export type FieldNotice = "added" | "updated" | "unavailable" | "mfa" | "invalid" | "role" | "limit" | "failed" | null;
export const MAX_FIELDS_PER_ENTITY = 20;
const KINDS: readonly FieldKind[] = ["text", "number", "date", "choice", "yes_no"];
const ENTITIES: readonly FieldEntity[] = ["contact", "catalogue_item"];

/**
 * Settings → Fields (job CL, blueprint section 6): the extra details a business keeps about its customers and its products. The business type comes with some (shown as "From your business type": they cannot be removed,
 * only hidden); the owner may add more (at most 20 for each; a field is never deleted, it is hidden). Personal and child fields are marked, and the screen says what not to type. A server component with plain forms
 * posting to server actions (no script). While the server cannot store fields yet (`source` is "fixture") the list is shown and the controls say "Not available yet": nothing is pretended.
 */
export function FieldsSection({ fields, entities, source, canEdit, notice, lang, add, setActive, t }: { fields: readonly WorkspaceField[]; entities: readonly FieldEntity[]; source: "api" | "fixture"; canEdit: boolean; notice: FieldNotice; lang: string; add: (formData: FormData) => Promise<void>; setActive: (formData: FormData) => Promise<void>; t: AppT }) {
  const editable = canEdit && source === "api";
  const message: Record<Exclude<FieldNotice, null>, [string, boolean]> = {
    added: [t("fields.notice.added"), true],
    updated: [t("fields.notice.updated"), true],
    unavailable: [t("fields.notice.unavailable"), false],
    mfa: [t("fields.notice.mfa"), false],
    invalid: [t("fields.notice.invalid"), false],
    role: [t("fields.notice.role"), false],
    limit: [t("fields.notice.limit"), false],
    failed: [t("fields.notice.failed"), false],
  };
  return (
    <div className="flex flex-col gap-5" data-part="fields">
      <p className="text-base text-muted">{t("fields.intro")}</p>
      {notice ? (
        <p role={message[notice][1] ? "status" : "alert"} className={message[notice][1] ? okLine : errorLine}>
          {message[notice][0]}
        </p>
      ) : null}
      {source === "fixture" ? <p className="text-sm text-muted">{t("fields.fixture")}</p> : null}
      {ENTITIES.filter((e) => entities.includes(e)).map((entity) => {
        const mine = fields.filter((f) => f.entity === entity);
        return (
          <section key={entity} aria-labelledby={`fields-${entity}`} className={card}>
            <h2 id={`fields-${entity}`} className="font-display text-xl font-semibold leading-tight">
              {t(`fields.entity.${entity}` as "fields.entity.contact")}
            </h2>
            <p className="text-sm text-muted">{t("fields.count", { n: mine.filter((f) => f.active).length, max: MAX_FIELDS_PER_ENTITY })}</p>
            {mine.length === 0 ? (
              <p className="text-base">{t("fields.none")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {mine.map((f) => (
                  <li key={f.code} data-field={f.code} data-active={f.active} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className={`min-w-0 flex-1 text-base ${f.active ? "font-medium" : "text-muted line-through"}`}>{textIn(f.label, lang)}</span>
                    <span className="text-sm text-muted">{t(`fields.kind.${f.kind}` as "fields.kind.text")}</span>
                    {f.source === "pack" ? <span className="rounded-full border border-line bg-surface-2 px-2 text-sm text-muted">{t("fields.from_pack")}</span> : null}
                    {f.required ? <span className="rounded-full border border-line bg-surface-2 px-2 text-sm text-muted">{t("fields.required")}</span> : null}
                    {f.pii_class !== "none" ? <span className="rounded-full border border-amber-text bg-amber-bg px-2 text-sm font-medium text-amber-text">{t(f.pii_class === "child" ? "fields.pii.child" : "fields.pii.personal")}</span> : null}
                    {editable && f.id ? (
                      <form action={setActive}>
                        <input type="hidden" name="field_id" value={f.id} />
                        <input type="hidden" name="active" value={f.active ? "no" : "yes"} />
                        <button type="submit" className={f.active ? secondary : primary}>
                          {f.active ? t("fields.hide") : t("fields.show")}
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {canEdit ? (
        <section aria-labelledby="fields-add" className={card}>
          <h2 id="fields-add" className="font-display text-xl font-semibold leading-tight">
            {t("fields.add.title")}
          </h2>
          <p className="text-sm text-muted">{t("fields.add.warn")}</p>
          {editable ? (
            <form action={add} className="flex flex-col gap-4">
              <div>
                <label htmlFor="fields-entity" className={label}>
                  {t("fields.add.entity")}
                </label>
                <select id="fields-entity" name="entity" className={field} defaultValue={entities[0]}>
                  {ENTITIES.filter((e) => entities.includes(e)).map((e) => (
                    <option key={e} value={e}>
                      {t(`fields.entity.${e}` as "fields.entity.contact")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="fields-label" className={label}>
                  {t("fields.add.label")}
                </label>
                <input id="fields-label" name="label" required maxLength={60} className={field} />
              </div>
              <div>
                <label htmlFor="fields-kind" className={label}>
                  {t("fields.add.kind")}
                </label>
                <select id="fields-kind" name="kind" className={field} defaultValue="text">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`fields.kind.${k}` as "fields.kind.text")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="fields-choices" className={label}>
                  {t("fields.add.choices")}
                </label>
                <textarea id="fields-choices" name="choices" rows={3} maxLength={600} className={`${field} py-2`} />
                <p className={help}>{t("fields.add.choices.help")}</p>
              </div>
              <label className="flex min-h-11 items-center gap-3 text-base">
                <input type="checkbox" name="required" className="size-6 shrink-0 accent-brand-text" />
                {t("fields.add.required")}
              </label>
              <div>
                <button type="submit" className={primary}>
                  {t("fields.add.save")}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-base text-muted" data-fields="not-available">
              {t("frame.notyet")}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
