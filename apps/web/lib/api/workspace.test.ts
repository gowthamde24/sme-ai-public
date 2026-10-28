import { describe, expect, it } from "vitest";

import { ApiContractError } from "./client";
import { parseWorkspaceProfile } from "./workspace";

const BODY = { name: "Glow", type: "salon", type_name: "Salon", type_label: null, city: "Guntur", phone: "", languages: ["en", "te"], logo_url: null, name_used_in: ["menu_header", "voice_preview", "something_new"], updated_at: null };

describe("the workspace profile answer", () => {
  it("is read field by field; an empty phone is none; words the screen does not know are left out", () => {
    expect(parseWorkspaceProfile(BODY)).toEqual({ name: "Glow", type: "salon", typeName: "Salon", typeLabel: null, city: "Guntur", phone: null, languages: ["en", "te"], logoUrl: null, nameUsedIn: ["menu_header", "voice_preview"] });
  });
  it.each([["no name", { ...BODY, name: "" }], ["a number as type", { ...BODY, type: 3 }], ["languages not a list", { ...BODY, languages: "en" }], ["no where-used list", { ...BODY, name_used_in: undefined }]])("%s is an error, never a guess", (_w, body) => {
    expect(() => parseWorkspaceProfile(body)).toThrow(ApiContractError);
  });
  it("a body that is not an object is an error", () => {
    expect(() => parseWorkspaceProfile(null)).toThrow(ApiContractError);
    expect(() => parseWorkspaceProfile([])).toThrow(ApiContractError);
  });
});
