/**
 * The product name. This is the ONE place the string exists: every page, string and test reads it from here, so a rename is this one line (a test fails if the literal appears anywhere else in v2 code).
 * Stack19 replaced the working name "Sme-AI (working name)" in job CX.
 */
export const BRAND_NAME = "Stack19";

/** The name without any note: for the places that carry a name but not a note (the home-screen icon label, the install hint). */
export const SHORT_NAME = BRAND_NAME.split(" ")[0];

/** The name as set inside running text. It has no hyphen to break at, so it is the name itself; the constant stays so `{brand}` in a string has one place to be made. */
export const BRAND_TEXT = BRAND_NAME;
