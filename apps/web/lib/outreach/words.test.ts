import { describe, expect, it } from "vitest";

import { sourceNames } from "./words";

describe("sourceNames: the plain name of every source a lead can come from", () => {
  const words = { "ld.source.indiamart": "IndiaMART", "ld.source.whatsapp": "WhatsApp", "ld.source.lead_finder": "Lead Finder", "ld.source.phone_call": "Phone call" };
  it("has the tags Lead Desk knows (the tag itself when the dictionary has no word) and the others a lead comes from: WhatsApp, a phone call, the Lead Finder", () => {
    const names = sourceNames(words);
    expect(names.indiamart).toBe("IndiaMART");
    expect(names.whatsapp).toBe("WhatsApp");
    expect(names.lead_finder).toBe("Lead Finder");
    expect(names.phone_call).toBe("Phone call");
    expect(names.justdial).toBe("justdial"); // (a known tag without a word: the tag, as before)
    expect(names.some_new_source).toBeUndefined(); // (the page shows an unknown one with its underscores taken out)
  });
});
