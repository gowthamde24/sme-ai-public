"use client";

import { useActionState } from "react";

import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { Avatar } from "../Avatar";
import { lettersOf } from "../letters";
import { errorLine, field, help, label, okLine, primary, secondary } from "../visits/styles";

type State = { ok: true } | { ok: false; error: string } | undefined;
type Action = (prev: State, formData: FormData) => Promise<State>;
export type MyProfileWords = Readonly<Record<string, string>>;

/**
 * Settings > My profile: every member sets their OWN name, language and picture (a JPG, PNG or WebP of at most 5 MB; the API makes the sizes). Until they pick one the Google photo shows, if they signed in with Google; "Remove picture" goes back to it.
 * The picture shows in the menu footer, the team list and the hand-off messages. `save` and `picture` are the server actions bound to the workspace.
 */
export function MyProfile({ words, name, addressAs, language, choices, pictureUrl, own, email, save, picture }: { words: MyProfileWords; name: string; /** "How should I address you?": undefined = the API has no such field yet, so it is not drawn. */ addressAs?: string; language: string; choices: readonly CallLang[]; pictureUrl: string | null; own: boolean; email: string | null; save: Action; picture: Action }) {
  const [saved, saveAction, saving] = useActionState(save, undefined);
  const [pic, picAction, uploading] = useActionState(picture, undefined);
  const w = (key: string) => words[key] ?? key;
  return (
    <div className="flex flex-col gap-6" data-part="my-profile">
      <h2 className="text-xl font-semibold">{w("settings.me.title")}</h2>
      <div className="flex flex-col gap-3" data-part="my-picture">
        <h3 className="text-base font-semibold">{w("settings.me.pic.title")}</h3>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar url={pictureUrl} letters={lettersOf(name || null, email)} className="grid size-20 shrink-0 place-items-center rounded-full bg-charcoal text-2xl font-semibold text-on-charcoal" />
          <form action={picAction} className="flex flex-wrap items-center gap-2">
            <label htmlFor="me-pic-file" className="sr-only">
              {w("settings.me.pic.choose")}
            </label>
            <input id="me-pic-file" name="picture" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="max-w-full text-sm" />
            <button type="submit" disabled={uploading} className={primary}>
              {w("settings.me.pic.save")}
            </button>
          </form>
          {own ? (
            <form action={picAction}>
              <input type="hidden" name="remove" value="1" />
              <button type="submit" disabled={uploading} className={secondary}>
                {w("settings.me.pic.remove")}
              </button>
            </form>
          ) : null}
        </div>
        <p className={help}>{w("settings.me.pic.help")}</p>
        {pic && !pic.ok ? (
          <p role="alert" className={errorLine}>
            {w(`settings.me.pic.err.${pic.error}`)}
          </p>
        ) : null}
        {pic?.ok ? (
          <p role="status" className={okLine}>
            {w("settings.me.pic.saved")}
          </p>
        ) : null}
      </div>
      <form action={saveAction} className="flex flex-col gap-4">
        <div>
          <label htmlFor="me-name" className={label}>
            {w("settings.me.name")}
          </label>
          <input id="me-name" name="display_name" required maxLength={100} defaultValue={name} autoComplete="name" disabled={saving} className={field} />
          <p className={help}>{w("settings.me.name.help")}</p>
        </div>
        {addressAs !== undefined ? (
          <div>
            <label htmlFor="me-address" className={label}>
              {w("settings.me.address")}
            </label>
            <input id="me-address" name="address_as" maxLength={30} defaultValue={addressAs} autoComplete="off" disabled={saving} className={field} />
            <p className={help}>{w("settings.me.address.help")}</p>
          </div>
        ) : null}
        <fieldset>
          <legend className={label}>{w("settings.me.lang")}</legend>
          <div className="flex flex-wrap gap-2">
            {choices.map((code) => (
              <label key={code} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-edge bg-surface px-4 text-base has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg">
                <input type="radio" name="language" value={code} defaultChecked={code === language} disabled={saving} className="size-5 accent-brand-text" />
                {CALL_LANG_NAMES[code]}
              </label>
            ))}
          </div>
        </fieldset>
        {saved && !saved.ok ? (
          <p role="alert" className={errorLine}>
            {w(`settings.me.err.${saved.error}`)}
          </p>
        ) : null}
        {saved?.ok ? (
          <p role="status" className={okLine}>
            {w("settings.me.saved")}
          </p>
        ) : null}
        <div>
          <button type="submit" disabled={saving} className={primary}>
            {w("settings.me.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
