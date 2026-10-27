import type { TypeWords } from "./TypeCombobox";

/** The words of the business-type list, from the sign-up dictionary (`signupT`): resolved on the server and passed down, so the browser carries no dictionary. */
export const typeWords = (t: (key: "signup.type.label" | "signup.type.placeholder" | "signup.type.none" | "signup.type.other.ask" | "signup.type.other.hint") => string): TypeWords => ({
  label: t("signup.type.label"),
  placeholder: t("signup.type.placeholder"),
  none: t("signup.type.none"),
  otherAsk: t("signup.type.other.ask"),
  otherHint: t("signup.type.other.hint"),
});
