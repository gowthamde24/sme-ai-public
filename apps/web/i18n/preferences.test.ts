import { describe, expect, it } from "vitest";

import { COOKIE_MAX_AGE, LANG_COOKIE, THEME_COOKIE, readLang, readTheme, serializePreference } from "@/i18n/preferences";

describe("preference cookies", () => {
  it("accepts only the four languages, defaulting to English", () => {
    for (const l of ["en", "te", "hi", "kn"]) expect(readLang(l)).toBe(l);
    for (const bad of [undefined, null, "", "fr", "EN", "te; Path=/", "<script>"]) expect(readLang(bad as string | undefined)).toBe("en");
  });
  it("accepts only light and dark; anything else means follow the system", () => {
    expect(readTheme("light")).toBe("light");
    expect(readTheme("dark")).toBe("dark");
    for (const bad of [undefined, null, "", "auto", "Dark", "dark;x"]) expect(readTheme(bad as string | undefined)).toBeUndefined();
  });
  it("writes Path=/, SameSite=Lax, one year, and Secure only over https", () => {
    expect(COOKIE_MAX_AGE).toBe(31536000);
    expect(serializePreference(LANG_COOKIE, "te", false)).toBe("sme_lang=te; Path=/; SameSite=Lax; Max-Age=31536000");
    expect(serializePreference(THEME_COOKIE, "dark", true)).toBe("sme_theme=dark; Path=/; SameSite=Lax; Max-Age=31536000; Secure");
  });
});
