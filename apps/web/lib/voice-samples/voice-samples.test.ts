import { describe, expect, it } from "vitest";

import { mockSampleWav } from "./mock";
import { MAX_SAMPLE_BYTES, readSampleQuery, sampleUrl, TONES } from "./types";

const q = (s: string) => readSampleQuery(new URLSearchParams(s));

describe("the voice-sample query (job DQ part 3)", () => {
  it("accepts closed words and the assistant's name, in every call language including Tamil and Malayalam", () => {
    expect(q("voice=female_warm&lang=ta&tone=warm&name=Vijaya")).toEqual({ voice: "female_warm", lang: "ta", tone: "warm", name: "Vijaya" });
    expect(q("voice=male_calm&lang=ml&tone=crisp")).toEqual({ voice: "male_calm", lang: "ml", tone: "crisp", name: "" });
  });
  it("refuses anything else: an unknown word, the owner's own voice (no sample), a name with symbols or too long", () => {
    expect(q("voice=robot&lang=en&tone=warm")).toBeNull();
    expect(q("voice=own_voice&lang=en&tone=warm")).toBeNull();
    expect(q("voice=male_calm&lang=xx&tone=warm")).toBeNull();
    expect(q("voice=male_calm&lang=en&tone=loud")).toBeNull();
    expect(q("voice=male_calm&lang=en&tone=warm&name=%3Cb%3E")).toBeNull();
    expect(q(`voice=male_calm&lang=en&tone=warm&name=${"a".repeat(25)}`)).toBeNull();
  });
  it("builds the address of our own route, with the name only when there is one", () => {
    expect(sampleUrl("/app/tenants/t/voice-sample", { voice: "male_calm", lang: "en", tone: "warm", name: "" })).toBe("/app/tenants/t/voice-sample?voice=male_calm&lang=en&tone=warm");
    expect(sampleUrl("/x", { voice: "male_calm", lang: "en", tone: "crisp", name: "Asha" })).toContain("name=Asha");
    expect(TONES).toEqual(["warm", "crisp"]);
  });
});

describe("the fake sample of the test screens", () => {
  it("is a valid small WAV, deterministic, and different for different voices and tones", () => {
    const a = mockSampleWav({ voice: "female_warm", lang: "en", tone: "warm", name: "" });
    expect(String.fromCharCode(...a.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...a.slice(8, 12))).toBe("WAVE");
    expect(a.length).toBeLessThan(MAX_SAMPLE_BYTES);
    expect(Array.from(mockSampleWav({ voice: "female_warm", lang: "en", tone: "warm", name: "" }))).toEqual(Array.from(a));
    expect(Array.from(mockSampleWav({ voice: "male_calm", lang: "en", tone: "warm", name: "" }))).not.toEqual(Array.from(a));
    expect(mockSampleWav({ voice: "female_warm", lang: "en", tone: "crisp", name: "" }).length).not.toBe(a.length);
  });
});
