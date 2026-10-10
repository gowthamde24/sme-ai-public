import { describe, expect, it } from "vitest";

import { owlRender } from "./owl-mode";

describe("owlRender: 3D, or the flat owl", () => {
  it("3D on a capable device", () => {
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true })).toBe("3d");
    expect(owlRender({ reducedMotion: false, webgl: true })).toBe("3d"); // a browser that does not say its cores is not treated as weak
    expect(owlRender({ reducedMotion: false, cores: 3, webgl: true })).toBe("3d");
  });
  it("the flat owl, standing still, with reduced motion (even when everything else is fine)", () => {
    expect(owlRender({ reducedMotion: true, cores: 8, webgl: true })).toBe("svg-still");
    expect(owlRender({ reducedMotion: true, cores: 8, webgl: false })).toBe("svg-still");
  });
  it("the flat owl when WebGL is missing", () => {
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: false })).toBe("svg");
  });
  it("the flat owl, and three.js never downloaded, when the data saver is on", () => {
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, saveData: true })).toBe("svg");
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, saveData: false })).toBe("3d");
  });
  it.each(["slow-2g", "2g", "3g"])("the flat owl on a %s connection", (effectiveType) => {
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, effectiveType })).toBe("svg");
  });
  it("the 3D owl on a 4g connection or one that does not say", () => {
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, effectiveType: "4g" })).toBe("3d");
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, effectiveType: undefined })).toBe("3d");
  });
  it("the flat owl on a device with 2 GB of memory or less; 4 GB is fine, and a browser that does not say is not weak", () => {
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, deviceMemory: 2 })).toBe("svg");
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, deviceMemory: 0.5 })).toBe("svg");
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, deviceMemory: 4 })).toBe("3d");
    expect(owlRender({ reducedMotion: false, cores: 8, webgl: true, deviceMemory: undefined })).toBe("3d");
  });
  it("reduced motion still wins over everything: the flat owl standing still", () => {
    expect(owlRender({ reducedMotion: true, cores: 1, webgl: false, saveData: true, effectiveType: "2g", deviceMemory: 1 })).toBe("svg-still");
  });
  it("the flat owl on a slow device: two cores or fewer", () => {
    expect(owlRender({ reducedMotion: false, cores: 2, webgl: true })).toBe("svg");
    expect(owlRender({ reducedMotion: false, cores: 1, webgl: true })).toBe("svg");
  });
});
