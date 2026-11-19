import { describe, expect, it } from "vitest";

import { DNC_REASONS, dncReasonKey, dncRemovable, indianMobile, isMaskedNumber, maskIndianMobile } from "./dnc";
import { MOCK_DNC } from "./dnc-mock";

describe("Do-Not-Call: the number a person types", () => {
  it("takes an Indian mobile number the way people write it and gives +91 and ten digits", () => {
    for (const typed of ["9848012345", "98480 12345", "+91 98480 12345", "+91-98480-12345", "919848012345", "09848012345", " (98480) 12345 "]) expect(indianMobile(typed)).toBe("+919848012345");
  });
  it("refuses anything that is not an Indian mobile number", () => {
    for (const typed of ["", "12345", "5848012345", "98480123456", "+1 984 801 2345", "+44 7911 123456", "98480x2345", "040 2345 6789", "+91 1234567890"]) expect(indianMobile(typed)).toBeNull();
  });
  it("shows a number as +91, the first five digits, dots and the last two", () => {
    expect(maskIndianMobile("+919848012321")).toBe("+91 98480 ••• 21");
    expect(maskIndianMobile(indianMobile("90000 12364") as string)).toBe("+91 90000 ••• 64");
  });
  it("only a masked-looking number from the API is drawn", () => {
    expect(isMaskedNumber("+91 98480 ••• 21")).toBe(true);
    expect(isMaskedNumber("+91 98480 xxx 21")).toBe(true);
    expect(isMaskedNumber("<b>+91</b>")).toBe(false);
    expect(isMaskedNumber("")).toBe(false);
  });
  it("only a number the owner added can be removed: STOP from the customer and a legal or complaint rule stay", () => {
    expect(DNC_REASONS.filter((reason) => dncRemovable({ reason }))).toEqual(["added_by_owner"]);
  });
  it("every reason has words, and the made-up list uses only known reasons", () => {
    expect(DNC_REASONS.map(dncReasonKey)).toEqual(["jobs.dnc.reason.stop_whatsapp", "jobs.dnc.reason.asked_on_call", "jobs.dnc.reason.added_by_owner", "jobs.dnc.reason.other"]);
    for (const e of MOCK_DNC) expect(DNC_REASONS).toContain(e.reason);
  });
});
