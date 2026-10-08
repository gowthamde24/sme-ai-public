/**
 * The product name is not decided. This is the ONE place the string exists: every page, string and test reads it from
 * here, so a rename is this one line (a test fails if the literal appears anywhere else in v2 code).
 */
export const BRAND_NAME = "Sme-AI (working name)";

/** The name as set inside running text: an invisible word joiner after the hyphen keeps "Sme-AI" on one line. */
export const BRAND_TEXT = BRAND_NAME.replace(/-(?=\p{L})/gu, "-⁠");
