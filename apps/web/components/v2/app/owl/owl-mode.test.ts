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
  it("the flat owl on a slow device: two cores or fewer", () => {
    expect(owlRender({ reducedMotion: false, cores: 2, webgl: true })).toBe("svg");
    expect(owlRender({ reducedMotion: false, cores: 1, webgl: true })).toBe("svg");
  });
});
