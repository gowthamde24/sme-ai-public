import { describe, expect, it } from "vitest";

import { INDIAN_STATES, addressProblem, fileProblem, gstProblem, mobileDigits, nameProblem, panProblem, phoneProblem, pinProblem, reasonProblem, stateProblem } from "./rules";

describe("the rules of the verification forms (owner, 26 Nov 2026)", () => {
  it("a name needs two letters", () => {
    expect(nameProblem("")).toBe("required");
    expect(nameProblem("A")).toBe("name");
    expect(nameProblem("12")).toBe("name");
    expect(nameProblem("అఆ")).toBeNull();
    expect(nameProblem("Asha Rao")).toBeNull();
  });
  it("a mobile number: ten digits starting 6 to 9; +91, 91, 0, spaces and dashes are stripped", () => {
    for (const ok of ["9876543210", "98765 43210", "+91 98765-43210", "919876543210", "09876543210", "091 98765 43210", "(98765) 43210"]) expect(mobileDigits(ok), ok).toBe("9876543210");
    for (const bad of ["5876543210", "987654321", "98765432101", "abc", "+1 9876543210", ""]) expect(mobileDigits(bad), bad).toBeNull();
    expect(phoneProblem("")).toBe("required");
    expect(phoneProblem("12345")).toBe("phone");
  });
  it("an address has a minimum length; the PIN is six digits, the first not 0", () => {
    expect(addressProblem("short")).toBe("address");
    expect(addressProblem("12 Main Road")).toBeNull();
    expect(pinProblem("515001")).toBeNull();
    for (const bad of ["012345", "51500", "5150011", "51500a"]) expect(pinProblem(bad), bad).toBe("pin");
  });
  it("the state is one of the 28 states and 8 territories", () => {
    expect(INDIAN_STATES).toHaveLength(36);
    expect(stateProblem("")).toBe("required");
    expect(stateProblem("Telangana")).toBeNull();
    expect(stateProblem("Atlantis")).toBe("state");
  });
  it("PAN is AAAAA9999A; GSTIN is 15 characters with a state code 01 to 38", () => {
    expect(panProblem("ABCDE1234F")).toBeNull();
    expect(panProblem("abcde1234f")).toBeNull();
    for (const bad of ["ABCDE12345", "ABCD1234FF", "ABC"]) expect(panProblem(bad), bad).toBe("pan");
    expect(gstProblem("36ABCDE1234F1Z5")).toBeNull();
    for (const bad of ["99ABCDE1234F1Z5", "36ABCDE1234F1X5", "36ABCDE1234F1Z"]) expect(gstProblem(bad), bad).toBe("gst");
  });
  it("a document: JPEG, PNG or PDF, not empty, at most 10 MB", () => {
    expect(fileProblem(null)).toBe("required");
    expect(fileProblem({ type: "image/png", size: 10 })).toBeNull();
    expect(fileProblem({ type: "image/gif", size: 10 })).toBe("file_type");
    expect(fileProblem({ type: "application/pdf", size: 0 })).toBe("file_empty");
    expect(fileProblem({ type: "application/pdf", size: 11 * 1024 * 1024 })).toBe("file_size");
  });
  it("the API's closed words have the sentence of the same field here; an unknown word is 'required'", () => {
    expect(reasonProblem("mobile_invalid")).toBe("phone");
    expect(reasonProblem("pincode_invalid")).toBe("pin");
    expect(reasonProblem("gstin_business_only")).toBe("gst_business");
    expect(reasonProblem("something_new")).toBe("required");
  });
});
