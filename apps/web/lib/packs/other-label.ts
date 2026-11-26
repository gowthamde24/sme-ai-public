/** The words of "Other" (what kind of business it is, in the owner's own words): 3 to 60 characters of plain text; the API also strips markup (C1, docs/contracts/business-type-label.md). */
export const OTHER_LABEL = { min: 3, max: 60 } as const;
/** The type id of "Other / Something else". */
export const OTHER_ID = "other";
export const tidyLabel = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
export const labelOk = (v: unknown): boolean => {
  const w = tidyLabel(v);
  return w.length >= OTHER_LABEL.min && w.length <= OTHER_LABEL.max;
};
