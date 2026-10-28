import { describe, expect, it } from "vitest";

import { sayLine } from "./lines";
import { DEFAULT_ASSISTANT_NAME } from "./name";
import { CALL_LANGS, STYLES } from "./types";

describe("the example opening line", () => {
  it("names the assistant when the owner has named it", () => {
    expect(sayLine("en", "warm", "Asha", "Sri Silks")).toBe("Hello! I'm Asha, the AI assistant at Sri Silks. I'm calling about your enquiry. Shall I send the details on WhatsApp?");
  });
  it("names nobody until the owner names the assistant (no fixed name), in every language and way of talking", () => {
    for (const lang of CALL_LANGS) for (const style of STYLES) {
      const line = sayLine(lang, style, DEFAULT_ASSISTANT_NAME, "Sri Silks");
      expect(line, `${lang} ${style}`).not.toMatch(/\{name\}|your assistant|Vijaya/i);
      expect(line, `${lang} ${style}`).toContain("Sri Silks");
    }
    expect(sayLine("en", "quick", DEFAULT_ASSISTANT_NAME, "Sri Silks")).toBe("Hi, this is the AI assistant at Sri Silks. Calling about your enquiry. Details on WhatsApp?");
  });
});
