/**
 * The shapes of a business-type pack (job CL, blueprint section 13). The files are packages/packs/<id>/pack.json, checked against packages/packs/pack.schema.json in CI; `make packs` bundles them into
 * lib/packs/packs.generated.json. A pack is DATA: words, which modules are on, extra fields, the first-run steps. No pack id is written anywhere in the code (a test greps for them): code asks the
 * registry (registry.ts), which is SERVER ONLY, and the client gets plain objects (`PackFrame` in components/v2/app/nav.ts).
 */
export type PackLang = "en" | "te" | "hi" | "kn";
export type PackText = Readonly<Record<PackLang, string>>;
export type FieldKind = "text" | "number" | "date" | "choice" | "multi_choice" | "yes_no";
export type FieldEntity = "contact" | "catalogue_item";
export type PiiClass = "none" | "personal" | "child";
export type Choice = { readonly code: string; readonly label: PackText };
export type FieldDef = {
  readonly entity: FieldEntity;
  readonly code: string;
  readonly kind: FieldKind;
  readonly label: PackText;
  readonly unit?: string;
  readonly required?: boolean;
  readonly pii_class: PiiClass;
  readonly choices?: readonly Choice[];
};
export type StepCheck = "business_profile" | "catalogue_has_items" | "quote_rules_set" | "delivery_rule_set" | "students_imported" | "fee_plan_set" | "whatsapp_connected" | "first_quote_sent" | "first_campaign_approved";
export type ActivationStep = { readonly id: string; readonly check: StepCheck; readonly title: PackText; readonly hint: PackText };
export type Accent = "rose" | "terracotta" | "sky";
export type PackDef = {
  readonly id: string;
  readonly version: number;
  readonly default: boolean;
  readonly signup: { readonly order: number; readonly show: boolean; readonly icon: "fabric" | "block" | "cap"; readonly accent: Accent };
  readonly name: PackText;
  readonly tagline: PackText;
  readonly business_name_default: PackText;
  readonly modules: readonly string[];
  readonly nav: { readonly bar: readonly string[] };
  readonly labels: Readonly<Record<string, PackText>>;
  readonly fields: readonly FieldDef[];
  readonly activation: { readonly style: "classic" | "steps"; readonly steps: readonly ActivationStep[] };
  readonly example_data: boolean;
};
export type PackBundle = { readonly languages: readonly PackLang[]; readonly modules: readonly string[]; readonly packs: readonly PackDef[] };

/** A custom field as the API gives it for ONE workspace: the pack's fields plus the ones the owner added (`source`). */
export type WorkspaceField = FieldDef & { readonly id: string | null; readonly source: "pack" | "owner"; readonly active: boolean };
