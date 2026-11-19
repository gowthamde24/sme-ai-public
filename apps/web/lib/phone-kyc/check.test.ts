import { describe, expect, it } from "vitest";

import { checkBody } from "./check";
import { b64Bytes, fieldProblems, fileTypeOf, normalNumber, NUMBER_SHAPE } from "./types";

const K = "33333333-3333-4333-8333-333333333333";
const GOOD = { kyc_id: K, doc_kind: "gst", legal_name: "Demo Silks Pvt Ltd", registration_number: "36abcde1234f1z5", email: "owner@example.test", address_line1: "1 Main Road", address_line2: "", city: "Hyderabad", state: "Telangana", postal_code: "500001", document: { name: "gst.pdf", content_type: "application/pdf", data_base64: "JVBERi0xLjQK" } };
const code = (o: unknown) => {
  const r = checkBody(o);
  return r.ok ? "ok" : r.code;
};

describe("the registration numbers", () => {
  it("knows the shape of each document's number, ignoring spaces and case", () => {
    expect(NUMBER_SHAPE.gst.test(normalNumber("36abcde 1234f1z5"))).toBe(true);
    expect(NUMBER_SHAPE.udyam.test(normalNumber("udyam-ts-02-0000001"))).toBe(true);
    expect(NUMBER_SHAPE.coi.test(normalNumber("U12345TG2020PTC123456"))).toBe(true);
    expect(NUMBER_SHAPE.coi.test(normalNumber("AAB-1234"))).toBe(true);
    expect(NUMBER_SHAPE.gst.test("UDYAM-TS-02-0000001")).toBe(false);
  });
  it("finds each wrong field, one by one", () => {
    const f = { docKind: "gst" as const, number: "36ABCDE1234F1Z5", legal: "Demo Silks", email: "a@b.in", addr1: "1 Road", addr2: "", city: "Hyderabad", state: "Telangana", postal: "500001" };
    expect(fieldProblems(f)).toEqual({});
    expect(fieldProblems({ ...f, number: "123", legal: "x", email: "no", addr1: "ab", city: "H", state: "T", postal: "012345" })).toEqual({ number: true, legal: true, email: true, addr1: true, city: true, state: true, postal: true });
    expect(fieldProblems({ ...f, postal: "50000" }).postal).toBe(true);
    expect(fieldProblems({ ...f, postal: "5000012" }).postal).toBe(true);
  });
  it("tells a file's kind by its type, else by its ending (a phone's gallery sometimes sends no type)", () => {
    expect(fileTypeOf("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(fileTypeOf("a.JPG", "")).toBe("image/jpeg");
    expect(fileTypeOf("a.png", "application/octet-stream")).toBe("image/png");
    expect(fileTypeOf("a.pdf", "image/gif")).toBeNull();
    expect(fileTypeOf("a.docx", "")).toBeNull();
  });
  it("counts the bytes a base64 string stands for, padding included", () => {
    expect(b64Bytes("QUJD")).toBe(3);
    expect(b64Bytes("QUI=")).toBe(2);
    expect(b64Bytes("QQ==")).toBe(1);
  });
});

describe("what the route accepts", () => {
  it("takes a good body and tidies it: the number upper-cased without spaces, the id lower-cased", () => {
    const r = checkBody({ ...GOOD, kyc_id: K.toUpperCase() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toMatchObject({ kyc_id: K, registration_number: "36ABCDE1234F1Z5", document: { content_type: "application/pdf" } });
  });
  it("refuses anything that is not our own form as a bad body", () => {
    expect(code(null)).toBe("bad_body");
    expect(code([])).toBe("bad_body");
    expect(code({ ...GOOD, extra: 1 })).toBe("bad_body");
    expect(code({ ...GOOD, kyc_id: "nope" })).toBe("bad_body");
    expect(code({ ...GOOD, doc_kind: "pan" })).toBe("bad_body");
    expect(code({ ...GOOD, legal_name: 5 })).toBe("bad_body");
    expect(code({ ...GOOD, document: { ...GOOD.document, extra: 1 } })).toBe("bad_body");
    expect(code({ ...GOOD, document: null })).toBe("bad_body");
  });
  it("names the first wrong typed field", () => {
    expect(code({ ...GOOD, registration_number: "123" })).toBe("field_number");
    expect(code({ ...GOOD, legal_name: "x" })).toBe("field_legal");
    expect(code({ ...GOOD, email: "no" })).toBe("field_email");
    expect(code({ ...GOOD, address_line1: "ab" })).toBe("field_addr1");
    expect(code({ ...GOOD, city: "" })).toBe("field_city");
    expect(code({ ...GOOD, state: "" })).toBe("field_state");
    expect(code({ ...GOOD, postal_code: "12345" })).toBe("field_postal");
    expect(code({ ...GOOD, address_line2: undefined })).toBe("ok");
  });
  it("refuses a file that is the wrong kind, not base64, empty, or over 5 MB", () => {
    expect(code({ ...GOOD, document: { ...GOOD.document, content_type: "image/gif" } })).toBe("kyc_file_type");
    expect(code({ ...GOOD, document: { ...GOOD.document, name: "" } })).toBe("kyc_file_type");
    expect(code({ ...GOOD, document: { ...GOOD.document, name: "x".repeat(100) } })).toBe("kyc_file_type");
    expect(code({ ...GOOD, document: { ...GOOD.document, data_base64: "not base64!" } })).toBe("kyc_file_unreadable");
    expect(code({ ...GOOD, document: { ...GOOD.document, data_base64: "" } })).toBe("kyc_file_unreadable");
    expect(code({ ...GOOD, document: { ...GOOD.document, data_base64: "QUJD".repeat(1_666_666) } })).toBe("ok"); // 4,999,998 bytes
    expect(code({ ...GOOD, document: { ...GOOD.document, data_base64: "QUJD".repeat(1_666_667) } })).toBe("kyc_file_too_large"); // 5,000,001 bytes
  });
});
