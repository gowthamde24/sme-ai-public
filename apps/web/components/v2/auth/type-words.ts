import type { TypeWords } from "./TypeCombobox";

/** The words of the business-type list, from the sign-up dictionary (`signupT`): resolved on the server and passed down, so the browser carries no dictionary. */
export const typeWords = (t: (key: "signup.type.label" | "signup.type.placeholder" | "signup.type.none" | "signup.type.other.ask" | "signup.type.other.hint" | "signup.type.describe.label" | "signup.type.describe.hint" | "signup.type.describe.button" | "signup.type.describe.closest" | "signup.type.describe.use" | "signup.type.describe.none") => string): TypeWords => ({
  describeLabel: t("signup.type.describe.label"),
  describeHint: t("signup.type.describe.hint"),
  describeButton: t("signup.type.describe.button"),
  describeClosest: t("signup.type.describe.closest"),
  describeUse: t("signup.type.describe.use"),
  describeNone: t("signup.type.describe.none"),
  label: t("signup.type.label"),
  placeholder: t("signup.type.placeholder"),
  none: t("signup.type.none"),
  otherAsk: t("signup.type.other.ask"),
  otherHint: t("signup.type.other.hint"),
});
