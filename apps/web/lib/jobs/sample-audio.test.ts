import { describe, expect, it } from "vitest";

import { apiSamplePath, pickSample, readSamplePath, sampleSrc } from "./sample-audio";

describe("the sample voices of the templates", () => {
  it("the API's path becomes the same path on our own site, in the language of the file", () => {
    expect(readSamplePath("/v1/job-samples/textiles/enquiry_call_right_away.te.mp3")).toEqual({ lang: "te", src: "/job-samples/textiles/enquiry_call_right_away.te.mp3" });
    expect(readSamplePath("/v1/job-samples/real_estate/site_visit.kn.mp3")?.src).toBe("/job-samples/real_estate/site_visit.kn.mp3");
  });
  it("only that exact shape: nothing else is a sample", () => {
    for (const v of ["", "/v1/job-samples/a/b.te.mp3/", "/v1/job-samples/a/b.ta.mp3", "/v1/job-samples/a/b.te.MP3", "/v1/job-samples/A/b.te.mp3", "/v1/job-samples/a/B.te.mp3", "/v1/job-samples/a/1b.te.mp3", "/v1/job-samples/a/b.c.te.mp3", "/v1/job-samples/a b/c.te.mp3", "/v1/job-samples/a%2fb/c.te.mp3", "/v2/job-samples/a/b.te.mp3", "v1/job-samples/a/b.te.mp3", "/v1/job-samples/a/b.te.mp3\n", "/v1/job-samples/a/b.te.mp3\u0000", "/v1/job-samples/" + "a".repeat(41) + "/b.te.mp3", null, undefined, 3, {}]) {
      expect(readSamplePath(v), String(v)).toBeNull();
    }
  });
  it("the route's pack and file: strict, both ways", () => {
    expect(sampleSrc("textiles", "x_y.en.mp3")).toBe("/job-samples/textiles/x_y.en.mp3");
    expect(apiSamplePath("textiles", "x_y.en.mp3")).toBe("/v1/job-samples/textiles/x_y.en.mp3");
    for (const [pack, file] of [["..", "x.te.mp3"], ["a", "../x.te.mp3"], ["a", "x.te.mp3.exe"], ["a/b", "x.te.mp3"], ["a", "x/y.te.mp3"], ["a", "x.te.mp3?x=1"], ["a\\b", "x.te.mp3"], ["", "x.te.mp3"], ["a", ""], ["a", ".te.mp3"], ["a", "x.fr.mp3"], ["Textiles", "x.te.mp3"]] as const) {
      expect(apiSamplePath(pack, file), `${pack} ${file}`).toBeNull();
      expect(sampleSrc(pack, file), `${pack} ${file}`).toBeNull();
    }
  });
  it("picks the person's language, then the business's, then Telugu, then English, else nothing", () => {
    const all = { te: "te", en: "en", hi: "hi", kn: "kn" };
    expect(pickSample(all, "hi", "kn")).toBe("hi");
    expect(pickSample({ te: "te", en: "en", kn: "kn" }, "hi", "kn")).toBe("kn");
    expect(pickSample({ te: "te", en: "en" }, "hi", "kn")).toBe("te");
    expect(pickSample({ en: "en" }, "hi", "kn")).toBe("en");
    expect(pickSample({ hi: "hi" }, "en", "kn")).toBeNull();
    expect(pickSample({ te: "te" }, "xx", null)).toBe("te");
    expect(pickSample(null, "te", "te")).toBeNull();
    expect(pickSample({}, "te", "te")).toBeNull();
  });
});
