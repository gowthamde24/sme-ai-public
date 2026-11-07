import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getMoneySummary, parseMoneySummary } from "./money";

/** app v4 part 6: C1's money summary (docs/contracts/money-and-stock.md), read field by field. */
const T = "22222222-2222-4222-8222-222222222222";
const ID = "ca000000-0000-4000-8000-0000000000f1";
const JSON_OK = { as_of: "2026-11-06", owed_paise: 1200000, overdue_paise: 700000, customers_owing: 1, customers_overdue: 1, paid_this_month_paise: 300000, month_from: "2026-11-01", top: [{ account_id: ID, company_id: ID, contact_id: null, name: "Sri Rama Builders", outstanding_paise: 1200000, overdue_paise: 700000 }], complete: true };
beforeEach(() => apiRequest.mockReset());

describe("the money summary", () => {
  it("reads the totals and who owes most; an account with no contact is null, never made up", () => {
    const s = parseMoneySummary(JSON_OK);
    expect(s).toMatchObject({ asOf: "2026-11-06", owedPaise: 1200000, overduePaise: 700000, customersOwing: 1, customersOverdue: 1, paidThisMonthPaise: 300000, monthFrom: "2026-11-01", complete: true });
    expect(s.top).toEqual([{ accountId: ID, companyId: ID, contactId: null, name: "Sri Rama Builders", outstandingPaise: 1200000, overduePaise: 700000 }]);
  });
  it.each([
    ["a money figure that is not whole paise", { owed_paise: 12.5 }],
    ["a negative figure", { paid_this_month_paise: -1 }],
    ["a date that is not a day", { as_of: "6 Nov" }],
    ["no completeness flag", { complete: undefined }],
    ["a row with no name", { top: [{ ...JSON_OK.top[0], name: " " }] }],
    ["a row with a bad account id", { top: [{ ...JSON_OK.top[0], account_id: "x" }] }],
  ])("refuses %s", (_what, over) => {
    expect(() => parseMoneySummary({ ...JSON_OK, ...over })).toThrow(ApiContractError);
  });
  it("asks the workspace's own address, with a day only when given; a bad id or day is never sent", async () => {
    apiRequest.mockResolvedValue(JSON_OK);
    await getMoneySummary("tok", T);
    await getMoneySummary("tok", T, "2026-11-06");
    expect(String(apiRequest.mock.calls[0][0])).toBe(`/v1/tenants/${T}/money/summary`);
    expect(String(apiRequest.mock.calls[1][0])).toBe(`/v1/tenants/${T}/money/summary?as_of=2026-11-06`);
    await expect(getMoneySummary("tok", "../x")).rejects.toThrow(ApiContractError);
    await expect(getMoneySummary("tok", T, "yesterday")).rejects.toThrow(ApiContractError);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
