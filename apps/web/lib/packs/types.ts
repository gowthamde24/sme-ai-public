/**
 * The shapes the web uses for a business type (job CL, blueprint section 13). A business type is DATA owned by the API (packages/packs/<id>/pack.json, loaded into the database by job CK): the web asks
 * `GET /v1/packs` (the sign-up cards) and `GET /v1/tenants/{id}/pack` and `.../modules` (a workspace) and never holds a copy of the files or a list of business types. No pack id is written anywhere
 * in the code; a screen asks "is this module on?" and "what is this word?".
 */
export type PackLang = "en" | "te" | "hi" | "kn";
/** A text in the languages the product has: `en` is always there, the others may be missing (the reader falls back to English). */
export type Words = Readonly<Record<string, string>>;
export type FieldKind = "text" | "number" | "date" | "choice" | "multi_choice" | "yes_no";
export type FieldEntity = "contact" | "catalogue_item";
/** `personal`: a field that holds a person's detail (a Viewer does not see it). A child's data is never a custom field on a contact. */
export type PiiClass = "none" | "personal";
export type Choice = { readonly code: string; readonly label: Words };
/** A custom field of ONE workspace, as the API gives it: the pack's fields (`source: "pack"`) and the ones the owner added (`"owner"`), active or not. */
export type WorkspaceField = {
  readonly id: string;
  readonly entity: FieldEntity;
  readonly code: string;
  readonly kind: FieldKind;
  readonly label: Words;
  readonly choices: readonly Choice[] | null;
  readonly required: boolean;
  readonly position: number;
  readonly piiClass: PiiClass;
  readonly mergeable: boolean;
  readonly active: boolean;
  readonly source: "pack" | "owner";
};

export type PackStatus = "draft" | "preview" | "published";
/** A business type a new person may choose (a sign-up card). `validated`: a real owner of this kind of business has reviewed it; if not the card says so. */
export type PackSummary = {
  readonly packId: string;
  readonly version: number;
  readonly status: PackStatus;
  readonly validated: boolean;
  readonly names: Words;
  readonly summary: Words;
  readonly accent: string;
  readonly owlProp: string;
};
/** The business type of one workspace (pinned to the version it chose). `modules` is what the workspace has ON (the API's own answer, default deny); `packModules` is the pack's default set. */
export type WorkspacePack = PackSummary & {
  readonly source: "signup" | "default" | "legacy" | "operator";
  readonly coreTab: string;
  readonly modules: readonly string[];
  readonly units: readonly string[];
  readonly defaultUnit: string | null;
  /** Does the pack ship example data? Without it the "Load example data" button would load an empty batch, so it is not offered. A server that does not say is taken as yes (the old behaviour). */
  readonly hasExampleData: boolean;
  /** Words by language, then key (`nav.item.quotes`, `word.customer`, `pack.core_tab`, ...). English carries every key; the others may be partial. */
  readonly labels: Readonly<Record<string, Readonly<Record<string, string>>>>;
};
export type AuthProviders = { readonly google: boolean; readonly facebook: boolean };
export type AccountSecurity = { readonly level: "aal1" | "aal2"; readonly neededFor: readonly string[]; /** The person turned two-step sign-in on (it is optional for everybody). Left out by an older API: then only the session level tells. */ readonly secondFactorOn?: boolean };
