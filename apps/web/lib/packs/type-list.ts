import { typeWords } from "@/components/v2/auth/type-words";
import type { TypeGroup, TypeWords } from "@/components/v2/auth/TypeCombobox";
import { signupT } from "@/i18n/signup";
import type { Lang } from "@/i18n/lang";
import { listPacks } from "@/lib/api/pack";
import { readTemplates } from "@/lib/lead-desk/source";

import { OTHER_TYPE, typeGroups } from "./other";
import { signupCards } from "./signup";

/**
 * The business-type list a page draws outside sign-up (Settings > Business): the same grouped list, the same words, built from `GET /v1/packs` and the Lead Desk templates, in the language in use. `otherId` is set only when the API lists "Other".
 * A list that cannot be read is empty (the page then leaves the type out and shows the rest). SERVER ONLY.
 */
export async function readTypeList(lang: Lang): Promise<{ groups: TypeGroup[]; words: TypeWords; otherId: string | null }> {
  const t = signupT(lang);
  const [packs, templates] = await Promise.all([listPacks().catch(() => []), readTemplates().catch(() => [])]);
  const groups = typeGroups(signupCards(packs, lang), new Set(templates.map((x) => x.packId)), { deep: t("signup.type.group.deep"), leads: t("signup.type.group.leads"), all: t("signup.type.group.all"), other: t("signup.type.other"), otherTagline: t("signup.type.other.tagline") });
  return { groups, words: typeWords(t), otherId: packs.some((p) => p.packId === OTHER_TYPE) ? OTHER_TYPE : null };
}
