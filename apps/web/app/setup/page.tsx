import { redirect } from "next/navigation";

import { authH1, authLead, authMain } from "@/components/v2/auth/ui";
import { getLang } from "@/i18n/get-lang";
import { signupT } from "@/i18n/signup";
import { ApiAuthError } from "@/lib/api/client";
import { fetchAccountSetup, type AccountSetup } from "@/lib/api/account";
import { requireUser } from "@/lib/auth/session";
import { listPacks } from "@/lib/api/pack";
import { parseSignupPack, pickSignupPack, signupCards, SIGNUP_PACK_COOKIE } from "@/lib/packs/signup";
import { readTemplates } from "@/lib/lead-desk/source";
import { OTHER_TYPE, typeGroups } from "@/lib/packs/other";
import { typeWords } from "@/components/v2/auth/type-words";
import { cookies } from "next/headers";


import { completeSetup } from "../app/setup/actions";
import { SetupForm } from "./setup-form";
import { BRAND_NAME } from "@/design/brand";

/** The cookie the browser kept while it was away at Google or Facebook; nothing outside a request. */
async function packCookie(): Promise<string | undefined> {
  try {
    return (await cookies()).get(SIGNUP_PACK_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

export const metadata = { title: `Set up your business · ${BRAND_NAME}` };
// A person's own screen: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /setup: the first-login set-up, in the look of the sign-in screens: the kind of business (one searchable list, with "Other"), its name and the language, then Today. Nothing else is required. `/app` sends a confirmed account with no business here
 * (`fetchAccountSetup` says `needed`). The form calls the server action `completeSetup` (../app/setup/actions, Job AD), which makes the account's one business and saves the name typed here.
 * Anyone it has nothing to do for (the business exists, or an invited person) is sent on to `/app`; if the state cannot be read the form is still shown (the action decides, again). A person
 * with no session is sent to sign in (requireUser).
 */
export default async function SetupPage() {
  const user = await requireUser();
  let state: AccountSetup["state"] | null = null;
  try {
    state = (await fetchAccountSetup(user.accessToken)).state;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    // the state could not be read: show the form; completing it is checked again by the database
  }
  if (state !== null && state !== "needed") redirect("/app");
  const lang = await getLang();
  const t = signupT(lang);
  // the kind of business chosen on the first sign-up step (job CL): in the account's metadata (e-mail way) or the cookie of the browser that went to Google or Facebook; checked against what `GET /v1/packs` offers (and again by the database)
  const packs = await listPacks().catch(() => []);
  const templates = await readTemplates();
  const remembered = user.signupPack ?? (await packCookie());
  const chosen = packs.length > 0 ? pickSignupPack(packs, remembered) : parseSignupPack(remembered);
  const groups = typeGroups(signupCards(packs, lang), new Set(templates.map((x) => x.packId)), { deep: t("signup.type.group.deep"), leads: t("signup.type.group.leads"), all: t("signup.type.group.all"), other: t("signup.type.other"), otherTagline: t("signup.type.other.tagline") });
  return (
    <main id="main" className={authMain} lang={lang}>
      <h1 className={authH1}>{t("setup.title")}</h1>
      <p className={authLead}>{t("setup.sub")}</p>
      <SetupForm
        action={completeSetup}
        lang={lang}
        groups={groups}
        remembered={chosen}
        otherId={packs.some((p) => p.packId === OTHER_TYPE) ? OTHER_TYPE : null}
        words={{ type: typeWords(t), name: t("setup.name.label"), nameHelp: t("setup.name.help"), language: t("setup.language"), submit: t("setup.submit"), error: t("setup.err.unknown") }}
      />
    </main>
  );
}
