import { describe, expect, it } from "vitest";

import { ApiContractError } from "./client";
import { parseMyProfile, parsePeople } from "./me";

describe("a member's own profile", () => {
  it("is read field by field", () => {
    expect(parseMyProfile({ display_name: "Ravi", language: "te", picture: "google", picture_url: "https://lh3.googleusercontent.com/a" })).toEqual({ displayName: "Ravi", language: "te", picture: "google", pictureUrl: "https://lh3.googleusercontent.com/a" });
    expect(parseMyProfile({ display_name: "Ravi", language: "te", picture: "none", picture_url: null, address_as: "Ravi garu" }).addressAs).toBe("Ravi garu");
    expect(parseMyProfile({ display_name: "Ravi", language: "te", picture: "none", picture_url: null, address_as: null }).addressAs).toBe("");
    expect(() => parseMyProfile({ display_name: "Ravi", language: "te", picture: "none", picture_url: null, address_as: "x".repeat(31) })).toThrow();
    const base = { display_name: "Ravi", language: "te", picture: "none", picture_url: null };
    expect(parseMyProfile({ ...base, preferred_chat_language: "hi" }).preferredChatLanguage).toBe("hi"); // the language pill's saved choice
    expect(parseMyProfile({ ...base, preferred_chat_language: "auto" }).preferredChatLanguage).toBe("auto");
    expect(parseMyProfile({ ...base, preferred_chat_language: null }).preferredChatLanguage).toBeNull(); // never chosen
    expect(parseMyProfile({ ...base, preferred_chat_language: "klingon" }).preferredChatLanguage).toBeNull();
    expect(parseMyProfile(base)).not.toHaveProperty("preferredChatLanguage"); // an API that does not have it yet
    expect(parseMyProfile({ display_name: null, language: null, picture: "none", picture_url: null })).toEqual({ displayName: null, language: null, picture: "none", pictureUrl: null });
  });
  it.each([["a picture kind it does not know", { picture: "facebook" }], ["no body", null], ["a name that is a number", { display_name: 3, picture: "none" }]])("%s is an error", (_w, body) => {
    expect(() => parseMyProfile(body)).toThrow(ApiContractError);
  });
});

describe("the people of the workspace", () => {
  it("is a list of names and pictures", () => {
    expect(parsePeople({ people: [{ user_id: "u1", display_name: "A", picture: "own", picture_url: "https://x/y" }] })).toEqual([{ userId: "u1", displayName: "A", picture: "own", pictureUrl: "https://x/y" }]);
  });
  it("a person without an id is an error", () => {
    expect(() => parsePeople({ people: [{ display_name: "A", picture: "none" }] })).toThrow(ApiContractError);
    expect(() => parsePeople({})).toThrow(ApiContractError);
  });
});
