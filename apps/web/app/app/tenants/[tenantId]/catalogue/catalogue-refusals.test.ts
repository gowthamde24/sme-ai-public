import { describe, expect, it } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { refusalOf } from "./catalogue-refusals";

const e = (status: number, code: string) => new ApiRequestError(status, code, "x");

describe("why a catalogue change was refused", () => {
  it.each([
    [e(403, "mfa_required"), "save", { key: "today.err.mfa", mfa: true }],
    [e(403, "forbidden"), "save", { key: "today.err.role" }],
    [e(403, "forbidden"), "price", { key: "catalogue.err.price_owner" }],
    [e(409, "needs_photo"), "save", { key: "catalogue.err.needs_photo" }],
    [e(409, "needs_photo"), "remove", { key: "catalogue.err.last_photo" }],
    [e(409, "customer_stopped"), "send", { key: "today.err.stopped" }],
    [e(422, "invalid_reference"), "send", { key: "catalogue.err.send.photo" }],
    [e(422, "invalid_reference"), "save", { key: "catalogue.err.invalid" }],
    [e(422, "validation_error"), "save", { key: "catalogue.err.invalid" }],
    [e(503, "catalogue_unavailable"), "save", { key: "catalogue.err.unavailable" }],
    [e(503, "api_unreachable"), "save", { key: "catalogue.err.unavailable" }],
    [e(409, "too_many_photos"), "save", { key: "catalogue.photo.full" }],
    [e(409, "photo_files_missing"), "save", { key: "catalogue.photo.err.missing" }],
    [e(415, "photo_type_unsupported"), "save", { key: "catalogue.photo.err.type" }],
    [e(404, "not_found"), "save", { key: "today.err.state", stale: true }],
    [e(403, "something_else"), "save", { key: "today.err.role" }],
    [e(500, "boom"), "save", { key: "today.err.generic" }],
    [new Error("anything"), "save", { key: "today.err.generic" }],
  ] as const)("%s in %s is %j", (error, context, expected) => {
    expect(refusalOf(error, context)).toEqual(expected);
  });

  it("a rejected session is not a refusal: it is thrown again", () => {
    expect(() => refusalOf(new ApiAuthError("x"))).toThrow(ApiAuthError);
  });
});
