import { describe, expect, it } from "vitest";

import { isJobsOnlyPath, notFoundPathOf } from "./closed";

const T = "/app/tenants/11111111-1111-4111-8111-111111111111";

describe("the pages that exist only while JOBS is on", () => {
  it("are the Jobs pages and What you sell, and nothing else", () => {
    for (const p of ["/jobs", "/jobs/new", "/jobs/abc", "/jobs/abc/", "/what-you-sell", "/what-you-sell/"]) expect(isJobsOnlyPath(`${T}${p}`), p).toBe(true);
    for (const p of ["", "/billing", "/catalogue", "/jobsboard", "/what-you-sell-more", "/settings/jobs", "/do-not-call"]) expect(isJobsOnlyPath(`${T}${p}`), p).toBe(false);
    expect(isJobsOnlyPath("/jobs")).toBe(false);
    expect(isJobsOnlyPath("/app/jobs")).toBe(false);
  });
  it("is answered with an address that has no page, in the same workspace", () => {
    expect(notFoundPathOf(`${T}/jobs/new`)).toBe(`${T}/not-found-while-jobs-is-off`);
    expect(notFoundPathOf("/other")).toBe("/app/not-found-while-jobs-is-off");
  });
});
