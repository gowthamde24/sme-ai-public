import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { setFallbackWords } from "@/components/v2/app/words";
import { appDict } from "@/i18n/app";

// the screens take their words as a prop (job BK); a unit test that renders one part on its own gets the English words
setFallbackWords(appDict("en") as Record<string, string>);

// next/font only works inside the Next build. The v2 wrapper (V2Root) loads the v2 fonts, so any test that renders a page or component that uses it
// would fail without this; a test that checks the fonts themselves (design/fonts.test.ts) mocks the module its own way, which wins over this one.
vi.mock("next/font/google", () => {
  const font = () => () => ({ variable: "font-var", className: "font-class" });
  return { Plus_Jakarta_Sans: font(), Bricolage_Grotesque: font(), Noto_Sans_Telugu: font(), Noto_Sans_Devanagari: font(), Noto_Sans_Kannada: font(), Geist: font(), Geist_Mono: font() };
});

afterEach(() => {
  cleanup();
});
